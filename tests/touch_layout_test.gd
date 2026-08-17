extends TestCase
## Mise en page des controles tactiles (C.1 et C.2).
##
## Ces cas montent les vrais controles et mesurent les vraies positions. Une
## mise en page tactile se casse silencieusement : on change une taille, un
## bouton sort de l'ecran ou deux cibles se touchent, et ca ne se voit qu'a
## la main sur un telephone. Ici ca echoue tout de suite.

const CONTROLS_SCENE: String = "res://src/scenes/ui/touch_controls.tscn"
const SCREEN: Vector2 = Vector2(1280.0, 720.0)

var _controls: CanvasLayer = null


func before_each() -> void:
	_controls = load(CONTROLS_SCENE).instantiate() as CanvasLayer
	tree.root.add_child(_controls)
	await tree.process_frame


func after_each() -> void:
	Settings.set_option(&"controls", &"left_handed", false)
	Settings.set_option(&"controls", &"button_scale", 1.0)
	if is_instance_valid(_controls):
		_controls.queue_free()
	_controls = null


func _stick() -> Control:
	return _controls.get("_stick") as Control


func _button_a() -> TouchButton:
	return _controls.get("_button_a") as TouchButton


func _button_b() -> TouchButton:
	return _controls.get("_button_b") as TouchButton


func _button_c() -> TouchButton:
	return _controls.get("_button_c") as TouchButton


func _buttons() -> Array[TouchButton]:
	return [_button_a(), _button_b(), _button_c()]


func _screen() -> Vector2:
	return Vector2(_controls.get_viewport().get_visible_rect().size)


# --- Disposition demandee ---------------------------------------------------

func test_stick_is_on_the_left_and_buttons_on_the_right() -> void:
	var screen: Vector2 = _screen()
	var middle: float = screen.x * 0.5
	assert_lt(_stick().position.x + _stick().size.x * 0.5, middle,
		"le stick doit rester dans la moitie gauche")
	for button: TouchButton in _buttons():
		assert_gt(button.position.x, middle, "les boutons doivent etre a droite")


func test_there_are_three_action_buttons() -> void:
	# A sauter, B frapper, C pouvoir.
	var buttons: int = 0
	for child: Node in _controls.get_child(0).get_children():
		if child is TouchButton:
			buttons += 1
	assert_eq(buttons, 3)


func test_the_stick_never_jumps() -> void:
	# Le saut n'existe QUE sur A. Deux facons de faire la meme chose, c'est
	# une facon de trop a 8 ans — et un enfant qui saute sans le vouloir en
	# poussant le stick vers le haut ne comprend plus ce qu'il controle.
	assert_ne(String(_stick().get("action_up")), "jump",
		"le haut du stick ne doit declencher aucun saut")
	# L'action branchee en haut ne doit etre lue par personne : c'est ce qui
	# garantit qu'elle ne fera jamais rien.
	assert_eq(String(_stick().get("action_up")), "move_up")
	assert_eq(String(_stick().get("action_down")), "move_down",
		"le bas est branche sur une action que rien ne consomme")
	assert_eq(String(_stick().get("action_left")), "move_left")
	assert_eq(String(_stick().get("action_right")), "move_right")


func test_a_is_the_biggest_and_the_lowest() -> void:
	# A est le saut : le pouce doit le trouver sans regarder (C.1).
	assert_gt(_button_a().size.y, _button_b().size.y)
	var a_bottom: float = _button_a().position.y + _button_a().size.y
	var b_bottom: float = _button_b().position.y + _button_b().size.y
	assert_almost_eq(a_bottom, b_bottom, 1.0, "les deux sont alignes par le bas")
	assert_gt(_button_a().position.x, _button_b().position.x,
		"A est le plus proche du bord, donc du pouce")


# --- Criteres de C.2 --------------------------------------------------------

func test_buttons_respect_the_edge_margin() -> void:
	var screen: Vector2 = _screen()
	var margin: float = TouchButton.EDGE_MARGIN
	for button: TouchButton in _buttons():
		var rect: Rect2 = button.get_rect()
		assert_gt(rect.position.x, margin - 1.0, "trop pres du bord gauche")
		assert_gt(rect.position.y, margin - 1.0, "trop pres du bord haut")
		assert_lt(rect.position.x + rect.size.x, screen.x - margin + 1.0,
			"deborde a droite")
		assert_lt(rect.position.y + rect.size.y, screen.y - margin + 1.0,
			"deborde en bas")


func test_no_two_buttons_are_too_close() -> void:
	# Avec trois cibles voisines, un doigt d'enfant doit pouvoir se tromper
	# de quelques millimetres sans declencher la mauvaise action.
	var margin: float = TouchButton.MIN_SPACING * 0.5
	var buttons: Array[TouchButton] = _buttons()
	for i: int in range(buttons.size()):
		for j: int in range(i + 1, buttons.size()):
			assert_false(
				buttons[i].get_rect().grow(margin).intersects(buttons[j].get_rect()),
				"%s et %s sont trop proches" % [buttons[i].text, buttons[j].text]
			)


func test_buttons_are_spread_further_than_the_minimum() -> void:
	# "Ecarte legerement les boutons" : l'ecart voulu depasse le minimum.
	assert_gt(TouchControls.BUTTON_GAP, TouchButton.MIN_SPACING)


func test_buttons_stay_above_the_c2_minimum() -> void:
	# Meme au reglage le plus petit, un bouton ne doit jamais passer sous les
	# 64 px du critere 1 de C.2.
	Settings.set_option(&"controls", &"button_scale", 0.85)
	await tree.process_frame
	for button: TouchButton in _buttons():
		assert_gt(button.size.x, TouchButton.MIN_VISUAL_SIZE - 0.5)
		assert_gt(button.size.y, TouchButton.MIN_VISUAL_SIZE - 0.5)


func test_stick_is_nearly_invisible_at_rest() -> void:
	# Au repos le stick ne doit pas manger la vue du niveau : on sait ou
	# poser son pouce, on n'a pas besoin de le voir en permanence.
	assert_almost_eq(_stick().modulate.a, TouchControls.STICK_IDLE_ALPHA, 0.001)
	assert_lt(TouchControls.STICK_IDLE_ALPHA, 0.1)


func test_stick_becomes_visible_when_used() -> void:
	# Sinon on ne verrait plus dans quelle direction on pousse.
	assert_gt(TouchControls.STICK_ACTIVE_ALPHA, TouchControls.STICK_IDLE_ALPHA * 10.0)
	assert_lt(TouchControls.STICK_FADE_SECONDS, 0.1,
		"critere 3 de C.2 : reaction visuelle sous 100 ms")


func test_stick_stays_fully_on_screen() -> void:
	# La position de repos est calculee depuis le rayon : un stick a cheval
	# sur un bord serait a moitie inatteignable.
	var screen: Vector2 = _screen()
	var control: Control = _stick()
	# `joystick_size` est un diametre.
	var radius: float = TouchControls.STICK_SIZE * 0.5
	var center: Vector2 = control.position + control.size * control.get(
		"initial_offset_ratio"
	)
	assert_gt(center.x - radius, 0.0, "le stick deborde a gauche")
	assert_lt(center.y + radius, screen.y + 1.0, "le stick deborde en bas")
	assert_lt(center.x + radius, screen.x, "le stick deborde a droite")


# --- Mode gaucher (C.9) -----------------------------------------------------

func test_left_handed_mirrors_the_whole_layout() -> void:
	Settings.set_option(&"controls", &"left_handed", true)
	await tree.process_frame
	var screen: Vector2 = _screen()
	var middle: float = screen.x * 0.5
	assert_gt(_stick().position.x + _stick().size.x * 0.5, middle,
		"stick a droite en mode gaucher")
	for button: TouchButton in _buttons():
		assert_lt(button.position.x, middle, "boutons a gauche en mode gaucher")


func test_left_handed_loses_no_button() -> void:
	Settings.set_option(&"controls", &"left_handed", true)
	await tree.process_frame
	# C.9 : aucune fonctionnalite n'est perdue.
	for button: TouchButton in _buttons():
		assert_true(button.visible, "aucun bouton ne disparait en mode gaucher")
	var margin: float = TouchButton.MIN_SPACING * 0.5
	assert_false(
		_button_a().get_rect().grow(margin).intersects(_button_b().get_rect()),
		"l'espacement doit tenir aussi en miroir"
	)


# --- Taille reglable --------------------------------------------------------

func test_smaller_preset_shrinks_the_buttons() -> void:
	var before: float = _button_a().size.y
	Settings.set_option(&"controls", &"button_scale", 0.85)
	await tree.process_frame
	assert_lt(_button_a().size.y, before,
		"le reglage Petit doit reellement reduire les boutons")


func test_largest_preset_still_fits_on_screen() -> void:
	# Doubler la base ET choisir "Tres grand" ne doit pas pousser un bouton
	# hors de l'ecran.
	Settings.set_option(&"controls", &"button_scale", 1.5)
	await tree.process_frame
	var screen: Vector2 = _screen()
	for button: TouchButton in _buttons():
		assert_gt(button.position.x, 0.0, "bouton hors ecran a gauche")
		assert_lt(button.position.y + button.size.y, screen.y + 1.0,
			"bouton hors ecran en bas")
