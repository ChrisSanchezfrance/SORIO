class_name CharacterDrawer
extends RefCounted
## Dessine un personnage HUMANOIDE dans une `Image`, pose par pose.
##
## Pourquoi ce fichier existe : SORIO doit ressembler a un petit bonhomme,
## pas a un rectangle etiquete. Comme rien ne passe par l'editeur et que la
## generation tourne en `--headless`, il faut savoir dessiner un personnage
## en pixels, sans fonte ni logiciel de dessin.
##
## Le principe est celui d'un pantin : un squelette de points articules
## (tete, epaules, coudes, mains, hanches, genoux, pieds), et chaque pose
## n'est qu'un jeu de coordonnees. Ajouter une animation ne demande donc
## qu'une entree dans `POSES`, jamais de code.
##
## Les memes fichiers servent au mode plateforme, au mode Course (Sprite3D en
## billboard, B.7) et aux mini-jeux : SORIO est le meme partout.

## Toile de reference (B.10). Les pieds reposent sur `GROUND_Y`.
const CANVAS: Vector2i = Vector2i(96, 128)
const GROUND_Y: int = 124

## Epaisseurs des membres, en pixels.
const LIMB_THICKNESS: int = 7
const LEG_THICKNESS: int = 9
const OUTLINE_EXTRA: int = 3

## Palette par defaut : SORIO, tunique verte (A.3).
const PALETTE_SORIO: Dictionary = {
	"skin": Color(0.99, 0.82, 0.66),
	"hair": Color(0.36, 0.22, 0.12),
	"tunic": Color(0.24, 0.68, 0.30),
	"trousers": Color(0.33, 0.27, 0.44),
	"boots": Color(0.46, 0.30, 0.17),
	"outline": Color(0.10, 0.08, 0.12),
	"eye": Color(0.10, 0.08, 0.12),
}

## Squelette au repos. Une pose ne redefinit que ce qui bouge.
const BASE_SKELETON: Dictionary = {
	"head": Vector2(48, 34),
	"neck": Vector2(48, 54),
	"hip": Vector2(48, 84),
	"shoulder_l": Vector2(38, 58),
	"shoulder_r": Vector2(58, 58),
	"elbow_l": Vector2(33, 73), "hand_l": Vector2(32, 89),
	"elbow_r": Vector2(63, 73), "hand_r": Vector2(64, 89),
	"knee_l": Vector2(42, 102), "foot_l": Vector2(41, 122),
	"knee_r": Vector2(54, 102), "foot_r": Vector2(55, 122),
}

const HEAD_RADIUS: float = 17.0
const EYE_RADIUS: float = 3.6
const EYE_OFFSET: Vector2 = Vector2(6.0, 1.0)

## Les 12 animations de B.10. Chaque entree liste ses poses, dans l'ordre.
## `run` a quatre images : c'est le minimum pour qu'une course se lise.
const ANIMATIONS: Dictionary = {
	"idle": ["idle", "idle_breathe"],
	"run": ["run_0", "run_1", "run_2", "run_3"],
	"jump": ["jump"],
	"fall": ["fall"],
	"land": ["land"],
	"hurt": ["hurt"],
	"dead": ["dead"],
	"cast": ["cast"],
	"dash": ["dash"],
	"swim": ["swim_0", "swim_1"],
	"roll": ["roll_0", "roll_1", "roll_2", "roll_3"],
	"victory": ["victory"],
}

## Une pose = les articulations qui s'ecartent du repos.
const POSES: Dictionary = {
	"idle": {},
	"idle_breathe": {
		"head": Vector2(48, 35), "neck": Vector2(48, 55),
		"hand_l": Vector2(32, 90), "hand_r": Vector2(64, 90),
	},
	# Course : jambes en ciseaux, bras opposes. Le buste avance legerement.
	"run_0": {
		"head": Vector2(50, 33), "neck": Vector2(49, 54),
		"elbow_l": Vector2(33, 68), "hand_l": Vector2(28, 56),
		"elbow_r": Vector2(63, 74), "hand_r": Vector2(70, 86),
		"knee_l": Vector2(58, 98), "foot_l": Vector2(68, 112),
		"knee_r": Vector2(40, 104), "foot_r": Vector2(30, 120),
	},
	"run_1": {
		"head": Vector2(49, 32), "neck": Vector2(48, 53),
		"elbow_l": Vector2(34, 71), "hand_l": Vector2(32, 84),
		"elbow_r": Vector2(62, 71), "hand_r": Vector2(64, 84),
		"knee_l": Vector2(50, 100), "foot_l": Vector2(52, 120),
		"knee_r": Vector2(46, 100), "foot_r": Vector2(42, 118),
	},
	"run_2": {
		"head": Vector2(50, 33), "neck": Vector2(49, 54),
		"elbow_l": Vector2(33, 74), "hand_l": Vector2(26, 86),
		"elbow_r": Vector2(63, 68), "hand_r": Vector2(68, 56),
		"knee_l": Vector2(40, 104), "foot_l": Vector2(30, 120),
		"knee_r": Vector2(58, 98), "foot_r": Vector2(68, 112),
	},
	"run_3": {
		"head": Vector2(49, 32), "neck": Vector2(48, 53),
		"elbow_l": Vector2(34, 71), "hand_l": Vector2(33, 84),
		"elbow_r": Vector2(62, 71), "hand_r": Vector2(63, 84),
		"knee_l": Vector2(46, 100), "foot_l": Vector2(44, 118),
		"knee_r": Vector2(50, 100), "foot_r": Vector2(54, 120),
	},
	# Saut : bras leves, jambes repliees. La silhouette doit se lire en l'air.
	"jump": {
		"elbow_l": Vector2(30, 56), "hand_l": Vector2(26, 38),
		"elbow_r": Vector2(66, 56), "hand_r": Vector2(70, 38),
		"knee_l": Vector2(40, 96), "foot_l": Vector2(35, 110),
		"knee_r": Vector2(56, 96), "foot_r": Vector2(61, 110),
	},
	"fall": {
		"elbow_l": Vector2(28, 64), "hand_l": Vector2(20, 58),
		"elbow_r": Vector2(68, 64), "hand_r": Vector2(76, 58),
		"knee_l": Vector2(38, 102), "foot_l": Vector2(32, 120),
		"knee_r": Vector2(58, 102), "foot_r": Vector2(64, 120),
	},
	# Atterrissage : accroupi, tout le corps tasse.
	"land": {
		"head": Vector2(48, 46), "neck": Vector2(48, 64), "hip": Vector2(48, 92),
		"shoulder_l": Vector2(37, 68), "shoulder_r": Vector2(59, 68),
		"elbow_l": Vector2(30, 82), "hand_l": Vector2(30, 98),
		"elbow_r": Vector2(66, 82), "hand_r": Vector2(66, 98),
		"knee_l": Vector2(36, 106), "foot_l": Vector2(38, 122),
		"knee_r": Vector2(60, 106), "foot_r": Vector2(58, 122),
	},
	"hurt": {
		"head": Vector2(44, 36), "neck": Vector2(46, 55),
		"elbow_l": Vector2(28, 60), "hand_l": Vector2(22, 44),
		"elbow_r": Vector2(64, 62), "hand_r": Vector2(72, 50),
		"knee_l": Vector2(42, 102), "foot_l": Vector2(36, 122),
		"knee_r": Vector2(56, 102), "foot_r": Vector2(62, 122),
	},
	"dead": {
		"head": Vector2(48, 40), "neck": Vector2(48, 58),
		"elbow_l": Vector2(26, 56), "hand_l": Vector2(18, 44),
		"elbow_r": Vector2(70, 56), "hand_r": Vector2(78, 44),
		"knee_l": Vector2(38, 100), "foot_l": Vector2(30, 112),
		"knee_r": Vector2(58, 100), "foot_r": Vector2(66, 112),
	},
	# Lancer de pouvoir : un bras tendu devant, appui arriere.
	"cast": {
		"elbow_l": Vector2(34, 74), "hand_l": Vector2(34, 90),
		"elbow_r": Vector2(68, 62), "hand_r": Vector2(84, 58),
		"knee_l": Vector2(40, 102), "foot_l": Vector2(34, 122),
		"knee_r": Vector2(56, 102), "foot_r": Vector2(62, 122),
	},
	"dash": {
		"head": Vector2(54, 38), "neck": Vector2(51, 57),
		"elbow_l": Vector2(38, 72), "hand_l": Vector2(24, 78),
		"elbow_r": Vector2(60, 70), "hand_r": Vector2(46, 76),
		"knee_l": Vector2(56, 100), "foot_l": Vector2(70, 106),
		"knee_r": Vector2(44, 104), "foot_r": Vector2(30, 116),
	},
	"swim_0": {
		"elbow_l": Vector2(30, 62), "hand_l": Vector2(22, 50),
		"elbow_r": Vector2(66, 66), "hand_r": Vector2(76, 62),
		"knee_l": Vector2(40, 100), "foot_l": Vector2(34, 116),
		"knee_r": Vector2(58, 102), "foot_r": Vector2(66, 118),
	},
	"swim_1": {
		"elbow_l": Vector2(32, 66), "hand_l": Vector2(26, 60),
		"elbow_r": Vector2(64, 62), "hand_r": Vector2(72, 48),
		"knee_l": Vector2(42, 102), "foot_l": Vector2(38, 120),
		"knee_r": Vector2(56, 100), "foot_r": Vector2(62, 114),
	},
	"victory": {
		"elbow_l": Vector2(28, 52), "hand_l": Vector2(24, 30),
		"elbow_r": Vector2(68, 52), "hand_r": Vector2(72, 30),
	},
}


## Dessine `pose` dans une image neuve et la retourne.
static func render_pose(pose_name: String, palette: Dictionary = PALETTE_SORIO) -> Image:
	var image: Image = Image.create(CANVAS.x, CANVAS.y, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))
	var joints: Dictionary = _resolve(pose_name)
	# La roulade n'est pas un pantin : c'est une boule. Cas a part assume.
	if pose_name.begins_with("roll_"):
		_draw_roll(image, palette, pose_name)
		return image
	# Deux passes : d'abord tout en couleur de contour et plus epais, puis
	# le remplissage par-dessus. C'est ce qui donne le contour net de B.10
	# sans avoir a calculer de silhouette.
	_draw_body(image, joints, palette, true)
	_draw_body(image, joints, palette, false)
	return image


## Fusionne la pose demandee avec le squelette au repos.
static func _resolve(pose_name: String) -> Dictionary:
	var joints: Dictionary = BASE_SKELETON.duplicate()
	var overrides: Dictionary = POSES.get(pose_name, {})
	for key: String in overrides:
		joints[key] = overrides[key]
	return joints


static func _draw_body(
	image: Image, joints: Dictionary, palette: Dictionary, outline: bool
) -> void:
	var extra: int = OUTLINE_EXTRA if outline else 0
	var limb: Color = palette["outline"] if outline else palette["skin"]
	var leg: Color = palette["outline"] if outline else palette["trousers"]
	var boot: Color = palette["outline"] if outline else palette["boots"]

	# Jambes, puis torse, puis bras : l'ordre donne la profondeur.
	_limb(image, joints["hip"], joints["knee_l"], LEG_THICKNESS + extra, leg)
	_limb(image, joints["knee_l"], joints["foot_l"], LEG_THICKNESS + extra, leg)
	_limb(image, joints["hip"], joints["knee_r"], LEG_THICKNESS + extra, leg)
	_limb(image, joints["knee_r"], joints["foot_r"], LEG_THICKNESS + extra, leg)
	_disc(image, joints["foot_l"], 5.0 + float(extra), boot)
	_disc(image, joints["foot_r"], 5.0 + float(extra), boot)

	_torso(image, joints, palette, outline, extra)

	_limb(image, joints["shoulder_l"], joints["elbow_l"], LIMB_THICKNESS + extra, limb)
	_limb(image, joints["elbow_l"], joints["hand_l"], LIMB_THICKNESS + extra, limb)
	_limb(image, joints["shoulder_r"], joints["elbow_r"], LIMB_THICKNESS + extra, limb)
	_limb(image, joints["elbow_r"], joints["hand_r"], LIMB_THICKNESS + extra, limb)
	_disc(image, joints["hand_l"], 4.5 + float(extra), limb)
	_disc(image, joints["hand_r"], 4.5 + float(extra), limb)

	_head(image, joints, palette, outline, extra)


## Tunique : un trapeze entre les epaules et les hanches.
static func _torso(
	image: Image, joints: Dictionary, palette: Dictionary, outline: bool, extra: int
) -> void:
	var color: Color = palette["outline"] if outline else palette["tunic"]
	var neck: Vector2 = joints["neck"]
	var hip: Vector2 = joints["hip"]
	var half_top: float = 11.0 + float(extra)
	var half_bottom: float = 14.0 + float(extra)
	var steps: int = int(maxf(1.0, neck.distance_to(hip)))
	for i: int in range(steps + 1):
		var t: float = float(i) / float(steps)
		var center: Vector2 = neck.lerp(hip, t)
		var half: float = lerpf(half_top, half_bottom, t)
		_horizontal_span(image, center.y, center.x - half, center.x + half, color)


static func _head(
	image: Image, joints: Dictionary, palette: Dictionary, outline: bool, extra: int
) -> void:
	var head: Vector2 = joints["head"]
	if outline:
		_disc(image, head, HEAD_RADIUS + float(extra), palette["outline"])
		return
	_disc(image, head, HEAD_RADIUS, palette["skin"])
	# Cheveux : la moitie superieure du disque.
	for y: int in range(int(head.y - HEAD_RADIUS), int(head.y - 2.0)):
		for x: int in range(int(head.x - HEAD_RADIUS), int(head.x + HEAD_RADIUS)):
			if Vector2(float(x), float(y)).distance_to(head) <= HEAD_RADIUS:
				_pixel(image, x, y, palette["hair"])
	# Gros yeux (B.10) : c'est ce qui rend le personnage lisible en petit.
	_disc(image, head + Vector2(-EYE_OFFSET.x, EYE_OFFSET.y), EYE_RADIUS, palette["eye"])
	_disc(image, head + Vector2(EYE_OFFSET.x, EYE_OFFSET.y), EYE_RADIUS, palette["eye"])


## Roulade : SORIO en boule, la tunique en cercle et une bande qui tourne.
static func _draw_roll(image: Image, palette: Dictionary, pose_name: String) -> void:
	var center: Vector2 = Vector2(48.0, 90.0)
	var radius: float = 30.0
	var index: int = int(pose_name.substr(pose_name.length() - 1))
	_disc(image, center, radius + float(OUTLINE_EXTRA), palette["outline"])
	_disc(image, center, radius, palette["tunic"])
	# Une bande orientee differemment a chaque image : la rotation se voit.
	var angle: float = float(index) * PI / 4.0
	var direction: Vector2 = Vector2(cos(angle), sin(angle)) * radius * 0.8
	_limb(image, center - direction, center + direction, 8, palette["boots"])
	_disc(image, center, 7.0, palette["skin"])


# --- Primitives de dessin ---------------------------------------------------

## Segment epais : la brique de base du pantin.
static func _limb(
	image: Image, from: Vector2, to: Vector2, thickness: int, color: Color
) -> void:
	var steps: int = int(maxf(1.0, from.distance_to(to)))
	var radius: float = float(thickness) / 2.0
	for i: int in range(steps + 1):
		_disc(image, from.lerp(to, float(i) / float(steps)), radius, color)


static func _disc(image: Image, center: Vector2, radius: float, color: Color) -> void:
	var r: int = int(ceil(radius))
	for y: int in range(int(center.y) - r, int(center.y) + r + 1):
		for x: int in range(int(center.x) - r, int(center.x) + r + 1):
			if Vector2(float(x), float(y)).distance_to(center) <= radius:
				_pixel(image, x, y, color)


static func _horizontal_span(
	image: Image, y: float, from_x: float, to_x: float, color: Color
) -> void:
	for x: int in range(int(from_x), int(to_x) + 1):
		_pixel(image, x, int(y), color)


static func _pixel(image: Image, x: int, y: int, color: Color) -> void:
	if x < 0 or y < 0 or x >= image.get_width() or y >= image.get_height():
		return
	image.set_pixel(x, y, color)
