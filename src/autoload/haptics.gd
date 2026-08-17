extends Node
## Retour haptique differencie (C.3).
##
## Une vibration doit porter une information. Le ramassage d'ambre n'en a
## volontairement aucune : trop frequent, la vibration deviendrait du bruit
## et le telephone tremblerait en continu.
##
## Tout passe par `pulse(&"cle")` — jamais d'appel direct a
## `Input.vibrate_handheld()` ailleurs dans le projet.

## Cle d'evenement -> duree en millisecondes. 0 = volontairement silencieux.
const PATTERNS: Dictionary = {
	&"ui_button": 10,
	&"jump": 15,
	&"amber": 0,          # volontairement aucune (C.3)
	&"power_pickup": 40,
	&"stomp": 25,
	&"damage": 80,
	&"death": 200,
	&"boss_hit": 60,
	&"crystal": 400,
}

## Sequences : liste de [duree, pause] en millisecondes.
const SEQUENCES: Dictionary = {
	&"boss_defeated": [[80, 100], [80, 100], [80, 0]],
}

## Evite qu'une pluie d'evenements simultanes ne fasse vibrer en continu.
const MIN_INTERVAL_MS: int = 30

var _last_pulse_ms: int = 0
var _sequence_running: bool = false


func _ready() -> void:
	# La vibration n'existe que sur mobile ; ailleurs les appels sont ignores
	# silencieusement, ce qui garde le code appelant identique partout.
	process_mode = Node.PROCESS_MODE_ALWAYS


func is_enabled() -> bool:
	return Settings.get_bool(&"controls", &"vibration")


## Declenche une vibration nommee. Cle inconnue = erreur de developpement.
func pulse(key: StringName) -> void:
	if not is_enabled():
		return
	if SEQUENCES.has(key):
		_play_sequence(key)
		return
	assert(PATTERNS.has(key), "Motif haptique inconnu : %s" % key)
	var duration: int = int(PATTERNS.get(key, 0))
	if duration <= 0:
		return
	var now: int = Time.get_ticks_msec()
	if now - _last_pulse_ms < MIN_INTERVAL_MS:
		return
	_last_pulse_ms = now
	Input.vibrate_handheld(duration)


func _play_sequence(key: StringName) -> void:
	if _sequence_running:
		return
	_sequence_running = true
	_run_sequence(SEQUENCES[key])


func _run_sequence(steps: Array) -> void:
	for step: Array in steps:
		if not is_enabled():
			break
		Input.vibrate_handheld(int(step[0]))
		var pause_ms: int = int(step[1])
		if pause_ms > 0:
			await get_tree().create_timer(float(step[0] + pause_ms) / 1000.0).timeout
	_sequence_running = false
