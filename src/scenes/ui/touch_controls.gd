extends CanvasLayer
## Controles tactiles (C.1).
##
## Version de la passe 1 : stick + bouton A + bouton B + bouton poche, avec
## la disposition, les marges et le mode gaucher deja corrects. L'habillage
## complet (tailles reglables en direct, apercu dans les options, D-pad) est
## de la passe 5 — mais rien ici ne sera a jeter.
##
## POINT CLE : les controles n'appellent JAMAIS le joueur. Ils poussent les
## memes actions Godot que le clavier (`Input.action_press`). Consequence :
## `Player` n'a pas une ligne de code specifique au tactile, et le multi-touch
## marche gratuitement — courir, sauter et lancer un pouvoir en meme temps
## sont trois doigts sur trois noeuds independants (critere 8 de C.2).

## Le stick occupe le tiers gauche de l'ecran (C.1).
const STICK_ZONE_RATIO: float = 1.0 / 3.0
const STICK_SIZE: float = 180.0
const STICK_TIP_SIZE: float = 78.0
## Marge de securite sous les controles : la zone de jeu reste degagee (C.1).
const SAFE_MARGIN: float = 80.0

## Tailles des trois boutons. A est le plus gros et le plus bas (C.1).
const BUTTON_A_SIZE: Vector2 = Vector2(120.0, 120.0)
const BUTTON_B_SIZE: Vector2 = Vector2(96.0, 96.0)
const BUTTON_POCKET_SIZE: Vector2 = Vector2(76.0, 76.0)

var _stick: VirtualJoystick = null
var _button_a: TouchButton = null
var _button_b: TouchButton = null
var _button_pocket: TouchButton = null
var _root: Control = null


func _ready() -> void:
	layer = 10
	_build()
	_apply_layout()
	EventBus.settings_changed.connect(_on_settings_changed)
	get_viewport().size_changed.connect(_apply_layout)


func _build() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	# Le stick natif de Godot 4.7 pousse directement les actions : aucune
	# conversion a ecrire, donc aucune divergence possible avec le clavier.
	_stick = VirtualJoystick.new()
	_stick.action_left = &"move_left"
	_stick.action_right = &"move_right"
	_stick.action_up = &"jump"
	_stick.action_down = &"move_down"
	_stick.joystick_size = STICK_SIZE
	_stick.tip_size = STICK_TIP_SIZE
	_stick.visibility_mode = VirtualJoystick.VISIBILITY_ALWAYS
	_root.add_child(_stick)

	_button_a = _make_button("A", BUTTON_A_SIZE, &"jump")
	_button_b = _make_button("B", BUTTON_B_SIZE, &"power")
	_button_pocket = _make_button("<>", BUTTON_POCKET_SIZE, &"swap_pocket")


## Un bouton tactile qui tient une action enfoncee tant que le doigt est pose.
## `button_down`/`button_up` plutot que `pressed` : le saut a hauteur variable
## a besoin de savoir que le doigt est TOUJOURS pose (critere 9 de C.2).
func _make_button(label: String, size: Vector2, action: StringName) -> TouchButton:
	var button: TouchButton = TouchButton.new()
	button.text = label
	button.custom_minimum_size = size
	button.size = size
	button.follow_button_scale = false
	button.add_theme_font_size_override("font_size", 28)
	button.button_down.connect(func() -> void: Input.action_press(action))
	button.button_up.connect(func() -> void: Input.action_release(action))
	_root.add_child(button)
	return button


func _on_settings_changed(section: StringName, key: StringName) -> void:
	if section == &"controls" and key in [&"left_handed", &"button_scale", &"dynamic_stick"]:
		_apply_layout()


## Positionne tout. Le mode gaucher (C.9) est un miroir horizontal complet :
## stick a droite, boutons a gauche, aucune fonctionnalite perdue.
func _apply_layout() -> void:
	var screen: Vector2 = Vector2(get_viewport().get_visible_rect().size)
	var left_handed: bool = Settings.get_bool(&"controls", &"left_handed")
	var scale: float = Settings.get_float_option(&"controls", &"button_scale")
	var edge: float = TouchButton.EDGE_MARGIN
	var gap: float = TouchButton.MIN_SPACING

	# Le stick est dynamique par defaut : il apparait la ou le pouce se pose
	# dans sa zone, plutot que d'imposer une position au joueur (C.1).
	var dynamic: bool = Settings.get_bool(&"controls", &"dynamic_stick")
	_stick.joystick_mode = (
		VirtualJoystick.JOYSTICK_DYNAMIC if dynamic else VirtualJoystick.JOYSTICK_FIXED
	)
	# Un stick dynamique affiche en permanence serait un mensonge visuel : il
	# n'est pas la ou il est dessine. Il ne se montre donc qu'une fois touche.
	_stick.visibility_mode = (
		VirtualJoystick.VISIBILITY_WHEN_TOUCHED
		if dynamic
		else VirtualJoystick.VISIBILITY_ALWAYS
	)
	var stick_width: float = screen.x * STICK_ZONE_RATIO
	_stick.size = Vector2(stick_width, screen.y * 0.6)
	_stick.position = Vector2(
		screen.x - stick_width if left_handed else 0.0,
		screen.y - _stick.size.y
	)

	# Boutons : A le plus gros et le plus bas, B au-dessus, poche a cote.
	var a_size: Vector2 = BUTTON_A_SIZE * scale
	var b_size: Vector2 = BUTTON_B_SIZE * scale
	var pocket_size: Vector2 = BUTTON_POCKET_SIZE * scale
	_resize(_button_a, a_size)
	_resize(_button_b, b_size)
	_resize(_button_pocket, pocket_size)

	var a_pos: Vector2 = Vector2(
		edge if left_handed else screen.x - edge - a_size.x,
		screen.y - edge - a_size.y
	)
	_button_a.position = a_pos
	_button_b.position = Vector2(
		a_pos.x + (a_size.x - b_size.x) * (0.0 if left_handed else 1.0),
		a_pos.y - gap - b_size.y
	)
	# La poche se place du cote interieur, vers le centre de l'ecran.
	var pocket_x: float = (
		a_pos.x + a_size.x + gap if left_handed else a_pos.x - gap - pocket_size.x
	)
	_button_pocket.position = Vector2(pocket_x, a_pos.y + a_size.y - pocket_size.y)


func _resize(button: TouchButton, size: Vector2) -> void:
	button.custom_minimum_size = size
	button.size = size
	button.pivot_offset = size / 2.0


## Hauteur reservee aux controles : la zone de jeu ne doit jamais etre
## recouverte (C.1). Le niveau s'en sert pour caler sa camera.
func reserved_bottom_height() -> float:
	return BUTTON_A_SIZE.y * Settings.get_float_option(&"controls", &"button_scale") \
		+ TouchButton.EDGE_MARGIN + SAFE_MARGIN
