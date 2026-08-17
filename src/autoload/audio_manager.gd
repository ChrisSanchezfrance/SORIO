extends Node
## Bus audio, fondus croises et limite de voix (B.3).
##
## Les bus sont crees par code au demarrage : aucun `default_bus_layout.tres`
## a regler dans l'editeur, donc rien qui puisse diverger entre le depot et la
## machine de quelqu'un.

const BUS_MASTER: StringName = &"Master"
const BUS_MUSIC: StringName = &"Music"
const BUS_SFX: StringName = &"SFX"
const BUS_VOICE: StringName = &"Voice"

## Limite de sons simultanes (B.3). Au-dela, un son de priorite basse est
## coupe au profit du nouveau ; un son de gameplay ne saute jamais.
const MAX_CONCURRENT_SFX: int = 8
const MUSIC_FADE_SECONDS: float = 1.2

## Volume en dessous duquel on coupe franchement le bus (evite -80 dB audibles).
const SILENCE_THRESHOLD: int = 1

var _music_players: Array[AudioStreamPlayer] = []
var _active_music: int = 0
var _current_music_id: StringName = &""
var _sfx_pool: Array[AudioStreamPlayer] = []
## Priorite du son en cours dans chaque lecteur du pool.
var _sfx_priority: Array[int] = []
var _fade_tween: Tween = null


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_ensure_buses()
	_build_players()
	apply_volumes()


## Cree les bus manquants. Idempotent : relancer ne duplique rien.
func _ensure_buses() -> void:
	for bus_name: StringName in [BUS_MUSIC, BUS_SFX, BUS_VOICE]:
		if AudioServer.get_bus_index(String(bus_name)) != -1:
			continue
		var index: int = AudioServer.bus_count
		AudioServer.add_bus(index)
		AudioServer.set_bus_name(index, String(bus_name))
		AudioServer.set_bus_send(index, String(BUS_MASTER))


func _build_players() -> void:
	# Deux lecteurs de musique : l'un s'eteint pendant que l'autre monte.
	for i: int in range(2):
		var player: AudioStreamPlayer = AudioStreamPlayer.new()
		player.bus = String(BUS_MUSIC)
		player.process_mode = Node.PROCESS_MODE_ALWAYS
		add_child(player)
		_music_players.append(player)
	# Pool d'effets alloue une fois pour toutes (D.2.3 : zero allocation en jeu).
	for i: int in range(MAX_CONCURRENT_SFX):
		var player: AudioStreamPlayer = AudioStreamPlayer.new()
		player.bus = String(BUS_SFX)
		add_child(player)
		_sfx_pool.append(player)
		_sfx_priority.append(0)


## Applique les volumes des options aux bus (C.7 Audio).
func apply_volumes() -> void:
	var muted: bool = Settings.get_bool(&"audio", &"mute_all")
	_set_bus_volume(BUS_MUSIC, Settings.get_int_option(&"audio", &"music"), muted)
	_set_bus_volume(BUS_SFX, Settings.get_int_option(&"audio", &"sfx"), muted)
	_set_bus_volume(BUS_VOICE, Settings.get_int_option(&"audio", &"voice"), muted)


func _set_bus_volume(bus_name: StringName, percent: int, muted: bool) -> void:
	var index: int = AudioServer.get_bus_index(String(bus_name))
	if index == -1:
		return
	var silent: bool = muted or percent < SILENCE_THRESHOLD
	AudioServer.set_bus_mute(index, silent)
	if silent:
		return
	# Conversion perceptuelle : un curseur a 50 % doit sonner "moitie moins".
	AudioServer.set_bus_volume_db(index, linear_to_db(float(percent) / 100.0))


# --- Musique ----------------------------------------------------------------

## Fondu croise vers une nouvelle musique. Rejouer la meme ne fait rien :
## la musique d'un monde continue d'un niveau a l'autre sans redemarrer.
func play_music(id: StringName, stream: AudioStream, fade: float = MUSIC_FADE_SECONDS) -> void:
	if id == _current_music_id and _music_players[_active_music].playing:
		return
	_current_music_id = id
	var outgoing: AudioStreamPlayer = _music_players[_active_music]
	_active_music = 1 - _active_music
	var incoming: AudioStreamPlayer = _music_players[_active_music]

	if stream == null:
		# Musique absente (phase placeholder) : on coupe proprement.
		_fade_out(outgoing, fade)
		return

	incoming.stream = stream
	incoming.volume_db = linear_to_db(0.001)
	incoming.play()

	if _fade_tween != null and _fade_tween.is_valid():
		_fade_tween.kill()
	_fade_tween = create_tween().set_parallel(true)
	_fade_tween.tween_property(incoming, "volume_db", 0.0, fade)
	if outgoing.playing:
		_fade_tween.tween_property(outgoing, "volume_db", linear_to_db(0.001), fade)
		_fade_tween.chain().tween_callback(outgoing.stop)


func stop_music(fade: float = MUSIC_FADE_SECONDS) -> void:
	_current_music_id = &""
	for player: AudioStreamPlayer in _music_players:
		_fade_out(player, fade)


func _fade_out(player: AudioStreamPlayer, fade: float) -> void:
	if not player.playing:
		return
	var tween: Tween = create_tween()
	tween.tween_property(player, "volume_db", linear_to_db(0.001), fade)
	tween.tween_callback(player.stop)


# --- Effets -----------------------------------------------------------------

## Joue un effet. `priority` haute = son de gameplay, prioritaire sur
## l'ambiance quand les 8 voix sont occupees.
func play_sfx(stream: AudioStream, priority: int = 0, pitch: float = 1.0) -> void:
	if stream == null:
		return
	var slot: int = _find_free_slot()
	if slot == -1:
		slot = _find_lowest_priority_slot(priority)
	if slot == -1:
		return  # tout est plus prioritaire : on laisse jouer, on n'ajoute rien
	var player: AudioStreamPlayer = _sfx_pool[slot]
	player.stream = stream
	player.pitch_scale = pitch
	player.play()
	_sfx_priority[slot] = priority


func _find_free_slot() -> int:
	for i: int in range(_sfx_pool.size()):
		if not _sfx_pool[i].playing:
			return i
	return -1


func _find_lowest_priority_slot(incoming_priority: int) -> int:
	var worst: int = -1
	var worst_priority: int = incoming_priority
	for i: int in range(_sfx_pool.size()):
		if _sfx_priority[i] < worst_priority:
			worst_priority = _sfx_priority[i]
			worst = i
	return worst


## Coupe tout : utilise quand l'application passe en arriere-plan (D.4).
func pause_all(paused: bool) -> void:
	AudioServer.set_bus_mute(AudioServer.get_bus_index(String(BUS_MASTER)), paused)
