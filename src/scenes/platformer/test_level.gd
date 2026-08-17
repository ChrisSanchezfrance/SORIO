class_name TestLevel
extends Node2D
## Niveau de test de la passe 1.
##
## Sa seule raison d'etre : juger le saut. Chaque section met a l'epreuve un
## point precis de B.4, et le nom de la section est ecrit au-dessus dans le
## jeu. On ne quitte pas la passe 1 tant que les six sections ne sont pas
## agreables au doigt.
##
## La geometrie est deja decrite en ASCII : c'est un avant-gout de
## `LevelBuilder` (passe 2), en volontairement plus simple — pas d'ennemis,
## pas de ramassables, juste du sol et des murs.

const TILE_SIZE: int = 64

## `#` solide, `.` vide, `S` depart. Chaque ligne fait la meme longueur.
const MAP: Array[String] = [
	"................................................................................",
	"................................................................................",
	"................................................................................",
	"...........................?...........................................?..?.....",
	".........?...?........................?..###....................###.............",
	".........................................###...............###..................",
	"..S......................................###..........###.......................",
	"####################..##########..#############...##############################",
	"####################..##########..#############...##############################",
	"####################..##########..#############...##############################",
	"####################..##########..#############...##############################",
]

## Section -> [colonne de depart, texte affiche].
const SECTIONS: Array[Dictionary] = [
	{"column": 2, "label": "1. course et arret"},
	{"column": 16, "label": "2. trou de 2 tuiles"},
	{"column": 24, "label": "3. rebord - coyote time"},
	{"column": 35, "label": "4. mur de 3 tuiles - saut maintenu"},
	{"column": 44, "label": "5. trou de 3 tuiles"},
	{"column": 53, "label": "6. escalier - jump buffer"},
	{"column": 8, "label": "cadeaux : saute dedans, ou tape avec B"},
]

## Ligne du sol dans la carte.
const GROUND_ROW: int = 7

## MARGE DE SAUT — regle 5 de B.6, appliquee des maintenant.
##
## Aucun trou ne depasse cette fraction de la portee maximale du joueur.
## 70 % laisse de quoi rater legerement l'appel, sauter un peu tot ou un peu
## tard, et retomber quand meme sur la plateforme suivante. Un trou calibre
## a 100 % de la portee serait franchissable en theorie et injouable en
## pratique — c'est exactement le genre de blocage qu'un enfant ne comprend
## pas et qui lui fait lacher le jeu.
const MAX_GAP_RATIO: float = 0.70

## Plein jour : le decor de fond fournit le ciel, donc la couleur de fond
## ne sert plus que de secours si une texture manque.
const BACKGROUND_COLOR: Color = Color(0.62, 0.85, 0.90)
## Terrain sombre et sature : il doit trancher nettement sur un fond clair,
## sinon un enfant ne distingue plus le sol du decor (A.7).
const TILE_COLOR: Color = Color(0.34, 0.24, 0.16)
const TILE_TOP_COLOR: Color = Color(0.36, 0.66, 0.28)
## Epaisseur de la bande claire sur le dessus des blocs : repere de sol.
const TILE_TOP_HEIGHT: float = 8.0

## Scene du Cadeau Surprise.
const GIFT_BOX_SCENE: String = "res://src/entities/pickups/gift_box.tscn"

var _solids: Array[Rect2] = []
var _player: Player = null
var _camera: GameCamera = null


## Largeur de chaque trou du sol, en tuiles. Statique : les tests la lisent
## sans avoir a monter la scene.
static func gap_widths() -> Array[int]:
	var gaps: Array[int] = []
	var run: int = 0
	# Le "#" ajoute a la fin ferme le dernier trou eventuel.
	var line: String = MAP[GROUND_ROW] + "#"
	for i: int in range(line.length()):
		if line[i] == ".":
			run += 1
		elif run > 0:
			gaps.append(run)
			run = 0
	return gaps


func _ready() -> void:
	RenderingServer.set_default_clear_color(BACKGROUND_COLOR)
	_check_gaps_are_jumpable()
	_build_backdrop()
	_build_geometry()
	_spawn_player()
	_spawn_gift_boxes()
	_setup_camera()
	_build_labels()
	_attach_debug_panel()
	_attach_touch_controls()
	_attach_power_hud()
	Perf.begin_sampling()


## Verifie que chaque trou reste franchissable avec de la marge. Le calcul
## vient de `PlayerConfig`, donc changer la gravite ou la vitesse de course
## rend ce controle faux immediatement plutot que trois niveaux plus tard.
func _check_gaps_are_jumpable() -> void:
	var config: PlayerConfig = load(Player.DEFAULT_CONFIG_PATH) as PlayerConfig
	if config == null:
		return
	var budget: float = config.max_jump_distance_tiles() * MAX_GAP_RATIO
	for gap: int in gap_widths():
		assert(
			float(gap) <= budget,
			"trou de %d tuiles pour un budget de %.1f (portee %.1f x %d %%)"
			% [gap, budget, config.max_jump_distance_tiles(), int(MAX_GAP_RATIO * 100.0)]
		)


## Le decor est ajoute en premier : il vit dans un CanvasLayer negatif,
## donc il passe derriere tout le reste quoi qu'il arrive ensuite.
func _build_backdrop() -> void:
	add_child(ParallaxBackdrop.new())


## Fusionne les tuiles solides voisines en bandes horizontales : 80 x 11
## tuiles feraient 880 formes de collision, la fusion en laisse une dizaine.
## C'est le budget de 200 noeuds de B.11 qui l'impose.
func _build_geometry() -> void:
	var body: StaticBody2D = StaticBody2D.new()
	body.name = "Solids"
	body.collision_layer = CollisionLayers.WORLD
	body.collision_mask = 0
	add_child(body)

	for row: int in range(MAP.size()):
		var line: String = MAP[row]
		var run_start: int = -1
		for column: int in range(line.length() + 1):
			var is_solid: bool = column < line.length() and line[column] == "#"
			if is_solid and run_start == -1:
				run_start = column
			elif not is_solid and run_start != -1:
				_add_strip(body, run_start, column - run_start, row)
				run_start = -1


func _add_strip(body: StaticBody2D, column: int, width: int, row: int) -> void:
	var rect: Rect2 = Rect2(
		float(column * TILE_SIZE), float(row * TILE_SIZE),
		float(width * TILE_SIZE), float(TILE_SIZE)
	)
	_solids.append(rect)

	var shape: CollisionShape2D = CollisionShape2D.new()
	var box: RectangleShape2D = RectangleShape2D.new()
	box.size = rect.size
	shape.shape = box
	shape.position = rect.position + rect.size / 2.0
	body.add_child(shape)


## Les cadeaux sont poses APRES le joueur : chacun recoit sa reference, donc
## aucun ne va la chercher dans l'arbre (D.2.4).
func _spawn_gift_boxes() -> void:
	var scene: PackedScene = load(GIFT_BOX_SCENE) as PackedScene
	if scene == null:
		push_error("[TestLevel] scene de cadeau introuvable")
		return
	for row: int in range(MAP.size()):
		var line: String = MAP[row]
		for column: int in range(line.length()):
			if line[column] != "?":
				continue
			var box: GiftBox = scene.instantiate() as GiftBox
			# Le repere d'un cadeau est son centre.
			box.global_position = Vector2(
				float(column * TILE_SIZE + TILE_SIZE / 2),
				float(row * TILE_SIZE + TILE_SIZE / 2)
			)
			box.setup(_player)
			add_child(box)


func _draw() -> void:
	for rect: Rect2 in _solids:
		draw_rect(rect, TILE_COLOR)
		# Bande claire sur le dessus : le bord du sol se lit d'un coup d'oeil.
		draw_rect(
			Rect2(rect.position, Vector2(rect.size.x, TILE_TOP_HEIGHT)), TILE_TOP_COLOR
		)


func _spawn_player() -> void:
	var scene: PackedScene = load("res://src/entities/player/player.tscn")
	_player = scene.instantiate() as Player
	_player.global_position = _find_spawn()
	add_child(_player)


func _find_spawn() -> Vector2:
	for row: int in range(MAP.size()):
		var column: int = MAP[row].find("S")
		if column != -1:
			# Le repere du joueur est a ses pieds : on vise le bas de la tuile.
			return Vector2(
				float(column * TILE_SIZE + TILE_SIZE / 2),
				float((row + 1) * TILE_SIZE)
			)
	push_error("[TestLevel] aucun point de depart 'S' dans la carte")
	return Vector2(128.0, 128.0)


func _setup_camera() -> void:
	_camera = GameCamera.new()
	_camera.name = "Camera"
	add_child(_camera)
	var bounds: Rect2i = Rect2i(
		0, -256,
		MAP[0].length() * TILE_SIZE, (MAP.size() * TILE_SIZE) + 256
	)
	_camera.setup(_player, bounds)
	_camera.global_position = _player.global_position
	_camera.make_current()


## Chaque section annonce ce qu'elle teste : on sait tout de suite quel point
## de B.4 est en cause quand quelque chose accroche.
func _build_labels() -> void:
	for section: Dictionary in SECTIONS:
		var label: Label = Label.new()
		label.text = String(section["label"])
		label.add_theme_font_size_override("font_size", 20)
		# Texte sombre cerne de clair : lisible sur un ciel de plein jour.
		label.add_theme_color_override("font_color", Color(0.12, 0.20, 0.12))
		label.add_theme_color_override("font_outline_color", Color(1, 1, 1, 0.85))
		label.add_theme_constant_override("outline_size", 6)
		label.position = Vector2(float(int(section["column"]) * TILE_SIZE), 96.0)
		add_child(label)


## Les controles tactiles poussent les memes actions Godot que le clavier :
## les deux cohabitent sans conflit, ce qui permet de tester au doigt et au
## clavier dans la meme session.
func _attach_touch_controls() -> void:
	add_child(load("res://src/scenes/ui/touch_controls.tscn").instantiate())


## Le HUD confirme le pouvoir, il ne l'annonce pas : c'est SORIO lui-meme,
## avec sa tenue coloree, qui porte l'information principale.
func _attach_power_hud() -> void:
	var hud: Node = load("res://src/scenes/ui/power_hud.tscn").instantiate()
	add_child(hud)
	hud.call(&"setup", _player.power_system)


func _attach_debug_panel() -> void:
	var panel: Node = load("res://src/scenes/ui/debug_panel.tscn").instantiate()
	add_child(panel)
	panel.call(&"attach", _player)
