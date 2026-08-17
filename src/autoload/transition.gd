extends Node
## Changements de scene, fondus et bouton retour Android (B.3, D.4).
##
## Aucune scene ne se charge en dur ailleurs dans le projet : tout passe par
## `Transition.go_to()`. C'est ce qui garantit qu'aucun ecran n'apparait sans
## fondu et qu'aucun ecran n'est un cul-de-sac.

const FADE_SECONDS: float = 0.25
## Au-dela de ce poids, on charge en tache de fond avec un ecran d'attente.
const THREADED_LOAD_HINT_SECONDS: float = 0.15

## Chemins des ecrans (C.6). Nommer ici evite les chaines dispersees.
const SCENES: Dictionary = {
	&"boot": "res://src/scenes/boot/boot.tscn",
	&"title": "res://src/scenes/title/title.tscn",
	&"save_slot": "res://src/scenes/save_slot/save_slot.tscn",
	&"world_map": "res://src/scenes/world_map/world_map.tscn",
	&"village": "res://src/scenes/village/village.tscn",
	&"platformer": "res://src/scenes/platformer/level.tscn",
	&"runner": "res://src/scenes/runner/runner.tscn",
	&"camp": "res://src/scenes/minigames/camp.tscn",
	## Un mini-jeu s'ouvre depuis le Camp OU en intermede entre deux niveaux
	## (LevelFlow). Meme scene dans les deux cas, seul le contexte change.
	&"minigame": "res://src/scenes/minigames/minigame_host.tscn",
	&"interlude": "res://src/scenes/minigames/interlude.tscn",
	&"shop": "res://src/scenes/shop/shop.tscn",
	&"collection": "res://src/scenes/collection/collection.tscn",
	&"options": "res://src/scenes/options/options.tscn",
	&"credits": "res://src/scenes/credits/credits.tscn",
}

var _layer: CanvasLayer = null
var _fade: ColorRect = null
var _busy: bool = false
## Pile des ecrans traverses, pour que le bouton retour recule d'un cran.
var _history: Array[StringName] = []
var current_screen: StringName = &"boot"


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_overlay()


func _build_overlay() -> void:
	_layer = CanvasLayer.new()
	# Au-dessus de tout, y compris du HUD et des modales.
	_layer.layer = 128
	add_child(_layer)

	_fade = ColorRect.new()
	_fade.color = Color(0.0, 0.0, 0.0, 0.0)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.visible = false
	_layer.add_child(_fade)


## Change d'ecran avec fondu. `screen` doit exister dans SCENES.
func go_to(screen: StringName, remember: bool = true) -> void:
	assert(SCENES.has(screen), "Ecran inconnu : %s" % screen)
	if _busy or not SCENES.has(screen):
		return
	if remember and current_screen != screen:
		_history.append(current_screen)
	await _change(String(SCENES[screen]))
	current_screen = screen


## Charge la scene de niveau en lui passant le fichier ASCII a construire.
## C'est le seul chemin par lequel un niveau demarre.
func go_to_path_with_level(level_file: String) -> void:
	if _busy:
		return
	_busy = true
	await fade_out()
	var packed: PackedScene = load("res://src/scenes/platformer/level.tscn") as PackedScene
	var level: Node = packed.instantiate()
	level.set(&"level_path", level_file)
	var tree: SceneTree = get_tree()
	if tree.current_scene != null:
		tree.current_scene.queue_free()
	tree.root.add_child(level)
	tree.current_scene = level
	await tree.process_frame
	await fade_in()
	_busy = false
	current_screen = &"platformer"


## Charge une scene par chemin (niveaux construits dynamiquement).
func go_to_path(path: String) -> void:
	if _busy:
		return
	await _change(path)


func _change(path: String) -> void:
	_busy = true
	await fade_out()
	var err: int = get_tree().change_scene_to_file(path)
	if err != OK:
		push_error("[Transition] chargement impossible : %s (code %d)" % [path, err])
	# Laisse une frame au moteur pour instancier la nouvelle scene avant
	# de reveler : sinon on voit un flash de l'ancienne.
	await get_tree().process_frame
	await fade_in()
	_busy = false


func fade_out(duration: float = FADE_SECONDS) -> void:
	_fade.visible = true
	_fade.color.a = 0.0
	var tween: Tween = create_tween()
	tween.tween_property(_fade, "color:a", 1.0, duration)
	await tween.finished


func fade_in(duration: float = FADE_SECONDS) -> void:
	var tween: Tween = create_tween()
	tween.tween_property(_fade, "color:a", 0.0, duration)
	await tween.finished
	_fade.visible = false


## Recule d'un ecran. Retourne false s'il n'y a plus d'historique :
## l'appelant decide alors quoi faire (demander confirmation sur le titre).
func go_back() -> bool:
	if _history.is_empty():
		return false
	var previous: StringName = _history.pop_back()
	await go_to(previous, false)
	return true


func clear_history() -> void:
	_history.clear()


# --- Notifications systeme Android (D.4) ------------------------------------

func _notification(what: int) -> void:
	match what:
		NOTIFICATION_WM_GO_BACK_REQUEST:
			# Le bouton retour materiel ne quitte JAMAIS le jeu directement :
			# chaque ecran decide, via ce signal, de ce que "reculer" veut dire.
			EventBus.back_requested.emit()
		NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_WM_WINDOW_FOCUS_OUT:
			# Passage en arriere-plan : on met en pause et on coupe le son,
			# sinon la musique continue par-dessus une autre application.
			if Game.is_in_level:
				get_tree().paused = true
				Game.is_paused = true
				EventBus.game_paused.emit(true)
			AudioManager.pause_all(true)
		NOTIFICATION_APPLICATION_FOCUS_IN, NOTIFICATION_WM_WINDOW_FOCUS_IN:
			AudioManager.pause_all(false)
