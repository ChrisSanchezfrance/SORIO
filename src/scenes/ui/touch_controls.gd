class_name TouchControls
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
## Tailles doublees a la demande : des doigts d'enfant sur un telephone
## visent mal, et un controle trop petit est la premiere cause de mort
## injuste. Le joueur peut redescendre via Options > Taille des boutons
## (Petit x0,85 jusqu'a Tres grand x1,5), qui multiplie ces valeurs.
const STICK_SIZE: float = 360.0
const STICK_TIP_SIZE: float = 156.0
## Marge de securite sous les controles : la zone de jeu reste degagee (C.1).
const SAFE_MARGIN: float = 80.0

## Deux boutons a droite, doubles. A reste le plus gros et le plus bas :
## c'est le saut, donc celui que le pouce doit trouver sans regarder (C.1).
const BUTTON_A_SIZE: Vector2 = Vector2(240.0, 240.0)
const BUTTON_B_SIZE: Vector2 = Vector2(192.0, 192.0)

## A et B sont COTE A COTE, alignes par le bas. Deux autres dispositions ont
## ete essayees et ecartees a cette taille : empiles, B finissait au milieu
## du ciel, hors de portee d'un pouce pose dans le coin ; en diagonale, les
## deux se chevauchaient (l'assertion plus bas l'a attrape). Cote a cote,
## les deux restent bas, dans la course naturelle du pouce, et ne masquent
## plus le ciel ni le volcan.

## Le bouton poche de C.1 revient en passe 4, avec les pouvoirs : tant qu'il
## n'y a rien a echanger, c'est une cible tactile qui masque le jeu pour
## rien.

## Hauteur de la lettre par rapport au bouton : un "A" de 28 px perdu au
## milieu d'un bouton de 240 px ne se lit pas comme une commande.
const LABEL_RATIO: float = 0.34

var _stick: VirtualJoystick = null
var _button_a: TouchButton = null
var _button_b: TouchButton = null
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


## Un bouton tactile qui tient une action enfoncee tant que le doigt est pose.
## `button_down`/`button_up` plutot que `pressed` : le saut a hauteur variable
## a besoin de savoir que le doigt est TOUJOURS pose (critere 9 de C.2).
func _make_button(label: String, size: Vector2, action: StringName) -> TouchButton:
	var button: TouchButton = TouchButton.new()
	button.text = label
	button.custom_minimum_size = size
	button.size = size
	button.follow_button_scale = false
	button.add_theme_font_size_override("font_size", int(size.y * LABEL_RATIO))
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
	# Le stick reste VISIBLE au repos, meme en mode dynamique. Un stick qui
	# n'apparait qu'au toucher n'existe pas pour un enfant qui decouvre le
	# jeu : il ne peut pas deviner qu'il faut poser le pouce quelque part.
	# En mode dynamique il se replace sous le pouce des le contact, donc on
	# garde la souplesse sans sacrifier la decouverte (D.6 : comprendre et
	# jouer seul en moins de 60 secondes).
	_stick.visibility_mode = VirtualJoystick.VISIBILITY_ALWAYS
	# Position de repos : la ou le pouce tombe quand on tient le telephone a
	# deux mains, mais jamais a cheval sur un bord. Le retrait est calcule
	# depuis le rayon reel du stick plus la marge de securite de C.2, donc
	# il reste correct meme si on change la taille ou la resolution.
	var stick_width: float = screen.x * STICK_ZONE_RATIO
	_stick.size = Vector2(stick_width, screen.y * 0.6)
	_stick.position = Vector2(
		screen.x - stick_width if left_handed else 0.0,
		screen.y - _stick.size.y
	)
	# `joystick_size` est un diametre : le retrait vaut donc la moitie, plus
	# la marge de bord.
	var inset: float = STICK_SIZE * 0.5 + edge
	var rest: Vector2 = Vector2(
		screen.x - inset if left_handed else inset,
		screen.y - inset
	)
	_stick.initial_offset_ratio = Vector2(
		clampf((rest.x - _stick.position.x) / maxf(1.0, _stick.size.x), 0.0, 1.0),
		clampf((rest.y - _stick.position.y) / maxf(1.0, _stick.size.y), 0.0, 1.0)
	)

	# A dans le coin, B en diagonale sur l'arc du pouce.
	var a_size: Vector2 = BUTTON_A_SIZE * scale
	var b_size: Vector2 = BUTTON_B_SIZE * scale
	_resize(_button_a, a_size)
	_resize(_button_b, b_size)

	var a_pos: Vector2 = Vector2(
		edge if left_handed else screen.x - edge - a_size.x,
		screen.y - edge - a_size.y
	)
	_button_a.position = a_pos

	# B se pose a cote de A, vers le centre de l'ecran, et aligne par le bas.
	# En mode gaucher il part de l'autre cote (C.9).
	var b_x: float = (
		a_pos.x + a_size.x + gap if left_handed else a_pos.x - gap - b_size.x
	)
	_button_b.position = Vector2(b_x, a_pos.y + a_size.y - b_size.y)

	# Critere 4 de C.2 : au moins 24 px de vide entre deux boutons. Verifie
	# ici plutot que relu, parce que le decalage est en pourcentage et qu'un
	# changement de taille pourrait les faire se toucher.
	assert(
		not _button_a.get_rect().grow(gap * 0.5).intersects(_button_b.get_rect()),
		"A et B se chevauchent ou sont trop proches"
	)


func _resize(button: TouchButton, size: Vector2) -> void:
	button.custom_minimum_size = size
	button.size = size
	button.pivot_offset = size / 2.0
	button.add_theme_font_size_override("font_size", int(size.y * LABEL_RATIO))


## Hauteur reservee aux controles : la zone de jeu ne doit jamais etre
## recouverte (C.1). Le niveau s'en sert pour caler sa camera.
func reserved_bottom_height() -> float:
	var scale: float = Settings.get_float_option(&"controls", &"button_scale")
	# A est le plus haut des deux : c'est lui qui fixe la hauteur occupee.
	return BUTTON_A_SIZE.y * scale + TouchButton.EDGE_MARGIN
