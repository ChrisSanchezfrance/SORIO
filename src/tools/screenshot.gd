extends Node
## Capture d'ecran automatisee, sans editeur ni intervention humaine.
##
##   xvfb-run -a godot --path . --resolution 1280x720 \
##       res://src/tools/screenshot.tscn -- \
##       --scene=res://src/scenes/title/title.tscn --out=build/title.png
##
## Raison d'etre : la contrainte du projet interdit d'ouvrir l'editeur, mais
## un jeu se juge a l'oeil. Cet outil charge n'importe quelle scene, laisse
## passer quelques frames pour que les animations et les Tween se placent,
## puis ecrit un PNG. C'est ce qui permet de valider visuellement chaque passe.

## Frames laissees au moteur avant la capture. Les `Tween` de fondu de
## `Transition` durent 0,25 s, soit 15 frames a 60 Hz.
const DEFAULT_WARMUP_FRAMES: int = 30

var _scene_path: String = ""
var _output_path: String = "user://screenshot.png"
var _warmup: int = DEFAULT_WARMUP_FRAMES


func _ready() -> void:
	_parse_arguments()
	if _scene_path.is_empty():
		printerr("usage : --scene=res://... [--out=chemin.png] [--frames=N]")
		get_tree().quit(2)
		return
	_capture()


func _parse_arguments() -> void:
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--scene="):
			_scene_path = argument.trim_prefix("--scene=")
		elif argument.begins_with("--out="):
			_output_path = argument.trim_prefix("--out=")
		elif argument.begins_with("--frames="):
			_warmup = maxi(1, int(argument.trim_prefix("--frames=")))


func _capture() -> void:
	var packed: Resource = ResourceLoader.load(_scene_path, "PackedScene")
	if packed == null:
		printerr("scene introuvable : %s" % _scene_path)
		get_tree().quit(1)
		return

	var instance: Node = (packed as PackedScene).instantiate()
	# La racine est encore occupee a construire ses enfants pendant `_ready` :
	# on laisse passer une frame avant de greffer la scene a capturer.
	await get_tree().process_frame
	get_tree().root.add_child(instance)

	for i: int in range(_warmup):
		await get_tree().process_frame

	# `get_texture().get_image()` lit le tampon reellement affiche : ce que
	# la capture montre est exactement ce que le joueur verrait.
	var image: Image = get_viewport().get_texture().get_image()
	var err: int = image.save_png(_output_path)
	if err != OK:
		printerr("ecriture impossible : %s (code %d)" % [_output_path, err])
		get_tree().quit(1)
		return

	print("capture ecrite : %s (%dx%d)" % [
		_output_path, image.get_width(), image.get_height()
	])
	get_tree().quit(0)
