extends Node
## Generation des assets provisoires (B.10).
##
##   godot --headless --path . res://src/tools/generate_placeholders.tscn
##
## Regle : LE JEU DOIT ETRE ENTIEREMENT JOUABLE EN PLACEHOLDERS. Aucun
## developpement ne s'arrete pour cause d'asset manquant. Cet outil fabrique
## une forme coloree ETIQUETEE pour tout ce qui manque, et ne touche jamais a
## un fichier deja present : le jour ou un vrai dessin arrive, il gagne.
##
## Respecte aussi la regle de lisibilite de A.7 : ce qui est dangereux recoit
## un contour sombre et un lisere rouge, ce qui est ramassable un halo clair.

const OUTPUT_ROOT: String = "res://assets/sprites/placeholder"

## Familles visuelles, qui portent la grammaire de lisibilite de A.7.
enum Kind { NEUTRAL, DANGER, PICKUP, TERRAIN, UI }

## Tailles de reference de B.10.
const SIZE_TILE: Vector2i = Vector2i(64, 64)
const SIZE_PLAYER: Vector2i = Vector2i(96, 128)
const SIZE_ENEMY: Vector2i = Vector2i(96, 96)
const SIZE_BOSS: Vector2i = Vector2i(384, 384)
const SIZE_ICON: Vector2i = Vector2i(96, 96)

const BORDER_THICKNESS: int = 4
## Lisere rouge des elements dangereux (A.7).
const DANGER_RIM: Color = Color(0.94, 0.20, 0.18)
const DANGER_OUTLINE: Color = Color(0.09, 0.05, 0.07)
## Halo clair des ramassables (A.7).
const PICKUP_HALO: Color = Color(1.0, 0.97, 0.75)

## Assets de base, toujours generes. Le contenu (ennemis, pouvoirs) s'y
## ajoute dynamiquement depuis la Database.
const BASE_SPECS: Array[Dictionary] = [
	{"name": "piko", "size": SIZE_ENEMY, "color": Color(0.98, 0.78, 0.35), "kind": Kind.NEUTRAL},
	{"name": "tile-solid", "size": SIZE_TILE, "color": Color(0.42, 0.31, 0.22), "kind": Kind.TERRAIN},
	{"name": "tile-oneway", "size": SIZE_TILE, "color": Color(0.56, 0.42, 0.28), "kind": Kind.TERRAIN},
	{"name": "tile-breakable", "size": SIZE_TILE, "color": Color(0.62, 0.48, 0.30), "kind": Kind.TERRAIN},
	{"name": "spike", "size": SIZE_TILE, "color": Color(0.55, 0.58, 0.62), "kind": Kind.DANGER},
	{"name": "lava", "size": SIZE_TILE, "color": Color(0.90, 0.35, 0.12), "kind": Kind.DANGER},
	{"name": "water", "size": SIZE_TILE, "color": Color(0.25, 0.55, 0.85), "kind": Kind.TERRAIN},
	{"name": "amber", "size": Vector2i(48, 48), "color": Color(1.0, 0.72, 0.20), "kind": Kind.PICKUP},
	{"name": "amber-hidden", "size": Vector2i(56, 56), "color": Color(1.0, 0.55, 0.15), "kind": Kind.PICKUP},
	{"name": "gift-box", "size": SIZE_TILE, "color": Color(0.80, 0.60, 0.30), "kind": Kind.PICKUP},
	{"name": "checkpoint", "size": Vector2i(64, 96), "color": Color(0.45, 0.85, 0.95), "kind": Kind.PICKUP},
	{"name": "flag", "size": Vector2i(64, 128), "color": Color(0.95, 0.85, 0.30), "kind": Kind.PICKUP},
]

## Personnages humanoides : id -> palette. SORIO, PAPI et GRANNA sont des
## humains, ils partagent donc le meme squelette et ne different que par la
## palette. PIKO est un pterodactyle et reste une forme simple.
const CHARACTERS: Dictionary = {
	"sorio": CharacterDrawer.PALETTE_SORIO,
	"papi": {
		"skin": Color(0.94, 0.79, 0.66), "hair": Color(0.82, 0.82, 0.80),
		"tunic": Color(0.56, 0.42, 0.30), "trousers": Color(0.36, 0.30, 0.28),
		"boots": Color(0.32, 0.24, 0.18), "outline": Color(0.10, 0.08, 0.12),
		"eye": Color(0.10, 0.08, 0.12),
	},
	"granna": {
		"skin": Color(0.93, 0.78, 0.64), "hair": Color(0.88, 0.86, 0.90),
		"tunic": Color(0.55, 0.34, 0.62), "trousers": Color(0.34, 0.24, 0.40),
		"boots": Color(0.30, 0.22, 0.28), "outline": Color(0.10, 0.08, 0.12),
		"eye": Color(0.10, 0.08, 0.12),
	},
}

## Vitesses d'animation, en images par seconde.
const ANIMATION_SPEED: Dictionary = {"run": 12.0, "roll": 14.0, "swim": 6.0, "idle": 2.0}
const DEFAULT_ANIMATION_SPEED: float = 8.0
## Animations qui ne bouclent pas : elles se jouent une fois et restent.
const ONCE_ANIMATIONS: Array[String] = ["land", "hurt", "dead", "cast", "victory"]

var _created: int = 0
var _skipped: int = 0


func _ready() -> void:
	print("=== Generation des placeholders ===")
	_ensure_directory(OUTPUT_ROOT)
	for spec: Dictionary in BASE_SPECS:
		_generate(spec)
	_generate_characters()
	_generate_from_database()
	print("- crees : %d   deja presents : %d" % [_created, _skipped])
	print("=== OK ===")
	get_tree().quit(0)


## Personnages humanoides : une image par pose, plus le `SpriteFrames` qui
## les assemble. Ces memes fichiers servent au mode plateforme, au mode
## Course (Sprite3D en billboard, B.7) et aux mini-jeux : SORIO garde la
## meme silhouette partout, c'est ce qui fait l'unite du jeu.
func _generate_characters() -> void:
	for character: String in CHARACTERS:
		var palette: Dictionary = CHARACTERS[character]
		var directory: String = "%s/%s" % [OUTPUT_ROOT, character]
		_ensure_directory(directory)
		for animation: String in CharacterDrawer.ANIMATIONS:
			for pose: String in CharacterDrawer.ANIMATIONS[animation]:
				_render_pose(directory, character, pose, palette)
		_write_sprite_frames(character, directory)


func _render_pose(
	directory: String, character: String, pose: String, palette: Dictionary
) -> void:
	var path: String = "%s/%s.png" % [directory, pose]
	if FileAccess.file_exists(path):
		_skipped += 1
		return
	var image: Image = CharacterDrawer.render_pose(pose, palette)
	if image.save_png(path) != OK:
		printerr("  * ecriture impossible : %s" % path)
		return
	_created += 1


## Ecrit le `.tres` qui relie les poses aux 12 animations de B.10.
func _write_sprite_frames(character: String, directory: String) -> void:
	var path: String = "res://resources/player/%s_frames.tres" % character
	var textures: Array[String] = []
	var blocks: PackedStringArray = PackedStringArray()

	for animation: String in CharacterDrawer.ANIMATIONS:
		var frames: PackedStringArray = PackedStringArray()
		for pose: String in CharacterDrawer.ANIMATIONS[animation]:
			var texture_path: String = "%s/%s.png" % [directory, pose]
			var index: int = textures.find(texture_path)
			if index == -1:
				textures.append(texture_path)
				index = textures.size() - 1
			frames.append(
				'{"duration": 1.0, "texture": ExtResource("%d_p")}' % index
			)
		blocks.append(
			'{\n"frames": [%s],\n"loop": %s,\n"name": &"%s",\n"speed": %.1f\n}'
			% [
				", ".join(frames),
				"false" if animation in ONCE_ANIMATIONS else "true",
				animation,
				float(ANIMATION_SPEED.get(animation, DEFAULT_ANIMATION_SPEED)),
			]
		)

	var header: PackedStringArray = PackedStringArray()
	for i: int in range(textures.size()):
		header.append(
			'[ext_resource type="Texture2D" path="%s" id="%d_p"]' % [textures[i], i]
		)

	var content: String = (
		'[gd_resource type="SpriteFrames" load_steps=%d format=3]\n\n' % (textures.size() + 1)
		+ "\n".join(header)
		+ '\n\n[resource]\nanimations = [' + ", ".join(blocks) + ']\n'
	)
	var file: FileAccess = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		printerr("  * ecriture impossible : %s" % path)
		return
	file.store_string(content)
	file.close()
	print("- %s : %d poses, %d animations" % [
		character, textures.size(), CharacterDrawer.ANIMATIONS.size()
	])


## Un placeholder par ennemi, boss et pouvoir declares dans les .tres.
## C'est ce qui fait qu'ajouter un 37e pouvoir ne demande aucun dessin.
func _generate_from_database() -> void:
	for id: StringName in Database.ids("enemies"):
		_generate({
			"name": "enemy-%s" % id, "size": SIZE_ENEMY,
			"color": _color_from_id(id), "kind": Kind.DANGER, "label": String(id),
		})
	for id: StringName in Database.ids("bosses"):
		_generate({
			"name": "boss-%s" % id, "size": SIZE_BOSS,
			"color": _color_from_id(id), "kind": Kind.DANGER, "label": String(id),
		})
	for id: StringName in Database.ids("powers"):
		_generate({
			"name": "power-%s" % id, "size": SIZE_ICON,
			"color": _color_from_id(id), "kind": Kind.PICKUP, "label": String(id),
		})


## Couleur stable derivee du nom : deux ennemis differents ne se ressemblent
## jamais, et la meme entite garde sa couleur d'une generation a l'autre.
func _color_from_id(id: StringName) -> Color:
	var hash_value: int = String(id).hash()
	var hue: float = float(hash_value % 1000) / 1000.0
	return Color.from_hsv(hue, 0.62, 0.88)


func _generate(spec: Dictionary) -> void:
	var file_name: String = String(spec["name"])
	var path: String = "%s/%s.png" % [OUTPUT_ROOT, file_name]
	if FileAccess.file_exists(path):
		_skipped += 1
		return

	var size: Vector2i = spec["size"]
	var kind: Kind = spec.get("kind", Kind.NEUTRAL)
	var image: Image = Image.create(size.x, size.y, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))

	_fill_body(image, size, spec["color"], kind)
	_draw_border(image, size, kind)
	_draw_label(image, size, String(spec.get("label", file_name)), kind)

	var err: int = image.save_png(path)
	if err != OK:
		printerr("  * ecriture impossible : %s (code %d)" % [path, err])
		return
	_created += 1


func _fill_body(image: Image, size: Vector2i, color: Color, kind: Kind) -> void:
	var inset: int = BORDER_THICKNESS
	for y: int in range(inset, size.y - inset):
		for x: int in range(inset, size.x - inset):
			var shade: Color = color
			# Degrade vertical leger : le volume se lit mieux qu'un aplat.
			var t: float = float(y) / float(maxi(1, size.y))
			shade = color.lerp(color.darkened(0.35), t)
			image.set_pixel(x, y, shade)
	if kind == Kind.PICKUP:
		_draw_halo(image, size)


## Contour epais sombre + lisere rouge pour tout ce qui blesse (A.7).
func _draw_border(image: Image, size: Vector2i, kind: Kind) -> void:
	var outline: Color = DANGER_OUTLINE if kind == Kind.DANGER else Color(0.08, 0.09, 0.12)
	for i: int in range(BORDER_THICKNESS):
		var color: Color = outline
		if kind == Kind.DANGER and i >= BORDER_THICKNESS / 2:
			color = DANGER_RIM
		_stroke_rect(image, size, i, color)


func _stroke_rect(image: Image, size: Vector2i, inset: int, color: Color) -> void:
	for x: int in range(inset, size.x - inset):
		image.set_pixel(x, inset, color)
		image.set_pixel(x, size.y - 1 - inset, color)
	for y: int in range(inset, size.y - inset):
		image.set_pixel(inset, y, color)
		image.set_pixel(size.x - 1 - inset, y, color)


## Halo clair des ramassables (A.7). L'oscillation verticale, elle, est
## ajoutee a l'execution par la scene du ramassable.
func _draw_halo(image: Image, size: Vector2i) -> void:
	var center: Vector2 = Vector2(size) * 0.5
	var radius: float = minf(float(size.x), float(size.y)) * 0.46
	for y: int in range(size.y):
		for x: int in range(size.x):
			var distance: float = Vector2(float(x), float(y)).distance_to(center)
			if distance > radius and distance < radius + 3.0:
				image.set_pixel(x, y, PICKUP_HALO)


## Etiquette : c'est elle qui rend le placeholder utilisable pour tester.
func _draw_label(image: Image, size: Vector2i, label: String, kind: Kind) -> void:
	var text: String = label.to_upper().replace("_", "-")
	var usable: int = size.x - BORDER_THICKNESS * 4
	var scale: int = PlaceholderFont.fit_scale(text, usable, 4)
	# Un nom trop long pour la boite est coupe plutot que deborde.
	while PlaceholderFont.measure(text, scale) > usable and text.length() > 3:
		text = text.substr(0, text.length() - 1)
	var width: int = PlaceholderFont.measure(text, scale)
	var x: int = (size.x - width) / 2
	var y: int = (size.y - PlaceholderFont.height(scale)) / 2
	# Ombre portee : lisible sur fond clair comme sur fond sombre.
	PlaceholderFont.draw_text(image, text, x + scale, y + scale, scale, Color(0, 0, 0, 0.65))
	var ink: Color = Color(1, 1, 1) if kind != Kind.PICKUP else Color(0.12, 0.10, 0.06)
	PlaceholderFont.draw_text(image, text, x, y, scale, ink)


func _ensure_directory(path: String) -> void:
	if DirAccess.dir_exists_absolute(path):
		return
	var err: int = DirAccess.make_dir_recursive_absolute(path)
	if err != OK:
		printerr("  * dossier impossible a creer : %s (code %d)" % [path, err])
