extends TestCase
## Physique de SORIO (B.4) — vraie simulation, pas de la theorie.
##
## Ces cas montent un monde minimal (un sol, un joueur), font tourner de
## vraies frames de physique et lisent le resultat. C'est le point 1 de la
## checklist D.5 : **le coyote time et le jump buffer sont verifies par un
## test**, pas par un ressenti.

const PLAYER_SCENE: String = "res://src/entities/player/player.tscn"
const FLOOR_Y: float = 400.0
const FLOOR_LEFT: float = -600.0
const FLOOR_RIGHT: float = 100.0
## Position clairement au-dela du bord droit du sol.
const OFF_LEDGE_X: float = 300.0
const PHYSICS_STEP: float = 1.0 / 60.0

var _world: Node2D = null
var _player: Player = null


func before_each() -> void:
	_world = Node2D.new()
	tree.root.add_child(_world)
	_build_floor()
	_build_player()
	# Quelques frames pour que SORIO se pose et que l'etat se stabilise.
	await _step(6)


func after_each() -> void:
	_release_all_input()
	if is_instance_valid(_world):
		_world.queue_free()
	_world = null
	_player = null


# --- Montage du monde -------------------------------------------------------

func _build_floor() -> void:
	var body: StaticBody2D = StaticBody2D.new()
	body.collision_layer = CollisionLayers.WORLD
	body.collision_mask = 0
	var shape: CollisionShape2D = CollisionShape2D.new()
	var box: RectangleShape2D = RectangleShape2D.new()
	box.size = Vector2(FLOOR_RIGHT - FLOOR_LEFT, 200.0)
	shape.shape = box
	shape.position = Vector2((FLOOR_LEFT + FLOOR_RIGHT) / 2.0, FLOOR_Y + 100.0)
	body.add_child(shape)
	_world.add_child(body)


func _build_player() -> void:
	var scene: PackedScene = load(PLAYER_SCENE)
	_player = scene.instantiate() as Player
	_player.global_position = Vector2(0.0, FLOOR_Y)
	_world.add_child(_player)


func _step(frames: int) -> void:
	for i: int in range(frames):
		await tree.physics_frame


## Un appui bref sur le saut.
##
## Le bouton est maintenu deux frames de physique avant d'etre relache :
## `SceneTree.physics_frame` est emis AVANT `_physics_process`, donc appuyer
## et relacher autour d'un seul `await` produit un appui que le joueur ne
## voit jamais.
func _tap_jump() -> void:
	Input.action_press(&"jump")
	await _step(2)
	Input.action_release(&"jump")


## Laisse s'ecouler la fenetre de coyote ouverte par un deplacement en l'air.
func _wait_for_coyote_to_close() -> void:
	# Marge d'une frame au-dela de la fenetre theorique.
	var frames: int = int(ceil(_player.config.coyote_time / PHYSICS_STEP)) + 2
	await _step(frames)


## Fait tomber SORIO jusqu'a friser le sol, sans l'avoir touche.
func _fall_until_close_to_floor() -> void:
	const NEAR_FLOOR: float = 90.0
	for i: int in range(120):
		if _player.global_position.y > FLOOR_Y - NEAR_FLOOR:
			return
		if _player.is_on_floor():
			return
		await tree.physics_frame


func _release_all_input() -> void:
	for action: StringName in [
		&"jump", &"move_left", &"move_right", &"move_up", &"move_down", &"attack",
	]:
		if Input.is_action_pressed(action):
			Input.action_release(action)


# --- Coyote time (B.4) ------------------------------------------------------

func test_coyote_window_opens_when_leaving_ground() -> void:
	assert_true(_player.is_on_floor(), "SORIO doit commencer au sol")
	# On le place au-dela du bord : il quitte le sol sans avoir saute.
	_player.global_position.x = OFF_LEDGE_X
	await _step(1)
	assert_false(_player.is_on_floor(), "SORIO doit avoir quitte le sol")
	assert_gt(_player.coyote_timer, 0.0, "la fenetre de coyote doit s'ouvrir")
	assert_almost_eq(
		_player.coyote_timer, _player.config.coyote_time, PHYSICS_STEP * 1.5,
		"la fenetre doit valoir coyote_time"
	)


func test_jump_works_inside_coyote_window() -> void:
	_player.global_position.x = OFF_LEDGE_X
	await _step(1)
	assert_gt(_player.coyote_timer, 0.0)
	await _tap_jump()
	await _step(1)
	assert_lt(
		_player.velocity.y, 0.0,
		"sauter juste apres avoir quitte le rebord doit fonctionner"
	)


func test_jump_refused_after_coyote_window() -> void:
	_player.global_position.x = OFF_LEDGE_X
	await _step(1)
	# 12 frames = 0,20 s, bien au-dela des 0,10 s de la fenetre.
	await _step(12)
	assert_eq(_player.coyote_timer, 0.0, "la fenetre doit etre fermee")
	await _tap_jump()
	await _step(1)
	assert_gt(
		_player.velocity.y, 0.0,
		"hors fenetre, SORIO doit continuer de tomber et non sauter"
	)


func test_coyote_window_does_not_allow_double_jump() -> void:
	# Sauter depuis le sol doit refermer la fenetre : sinon on obtiendrait
	# un second saut gratuit en plein vol.
	await _tap_jump()
	await _step(2)
	assert_lt(_player.velocity.y, 0.0, "le premier saut doit partir")
	var height_after_first: float = _player.velocity.y
	await _tap_jump()
	await _step(1)
	assert_lt(
		_player.velocity.y, height_after_first + absf(_player.config.jump_velocity),
		"aucun second saut ne doit relancer SORIO"
	)


# --- Jump buffer (B.4) ------------------------------------------------------

func test_jump_buffer_is_armed_while_airborne() -> void:
	_player.global_position = Vector2(0.0, FLOOR_Y - 300.0)
	# ATTENTION : deplacer SORIO en l'air lui ouvre une fenetre de coyote,
	# exactement comme s'il venait de quitter un rebord. Sans attendre sa
	# fermeture, le saut partirait tout de suite et le tampon serait remis a
	# zero — le test mesurerait alors autre chose que ce qu'il annonce.
	await _wait_for_coyote_to_close()
	assert_false(_player.is_on_floor())
	Input.action_press(&"jump")
	await _step(2)
	assert_gt(
		_player.jump_buffer_timer, 0.0,
		"un appui en l'air doit etre memorise"
	)
	Input.action_release(&"jump")


func test_jump_buffer_fires_on_landing() -> void:
	# SORIO tombe de haut ; on appuie juste AVANT le contact, hors fenetre de
	# coyote. Le saut doit partir tout seul a l'atterrissage : c'est tout
	# l'interet du jump buffer.
	_player.global_position = Vector2(0.0, FLOOR_Y - 400.0)
	await _wait_for_coyote_to_close()
	await _fall_until_close_to_floor()
	assert_false(_player.is_on_floor(), "SORIO doit encore etre en chute")
	assert_eq(
		_player.coyote_timer, 0.0,
		"la fenetre de coyote doit etre fermee, sinon le saut partirait par elle"
	)

	await _tap_jump()

	var jumped: bool = false
	# On laisse le temps d'atterrir puis de rebondir.
	for i: int in range(20):
		await tree.physics_frame
		if _player.velocity.y < -100.0:
			jumped = true
			break
	assert_true(jumped, "le saut memorise doit partir des l'atterrissage")


func test_jump_buffer_expires() -> void:
	_player.global_position = Vector2(0.0, FLOOR_Y - 600.0)
	await _wait_for_coyote_to_close()
	await _tap_jump()
	# 12 frames de plus = 0,20 s, au-dela des 0,12 s du buffer.
	await _step(12)
	assert_eq(
		_player.jump_buffer_timer, 0.0,
		"un appui trop ancien ne doit plus etre memorise"
	)


# --- Hauteur de saut et coupure --------------------------------------------

func test_full_jump_reaches_expected_height() -> void:
	var start_y: float = _player.global_position.y
	Input.action_press(&"jump")
	# Bouton maintenu : saut complet, aucune coupure.
	var highest: float = start_y
	for i: int in range(60):
		await tree.physics_frame
		highest = minf(highest, _player.global_position.y)
		if _player.velocity.y > 0.0 and _player.is_on_floor():
			break
	Input.action_release(&"jump")
	var reached: float = start_y - highest
	var expected: float = _player.config.max_jump_height()
	# Tolerance large : la discretisation a 60 Hz coute quelques pixels.
	assert_between(
		reached, expected * 0.85, expected * 1.15,
		"saut complet attendu autour de %.0f px, obtenu %.0f px" % [expected, reached]
	)


func test_released_jump_is_shorter_than_held_jump() -> void:
	# Saut a hauteur variable : c'est ce qui rend le controle fin possible.
	var start_y: float = _player.global_position.y
	Input.action_press(&"jump")
	await _step(3)
	Input.action_release(&"jump")
	var highest: float = start_y
	for i: int in range(60):
		await tree.physics_frame
		highest = minf(highest, _player.global_position.y)
		if _player.is_on_floor() and _player.velocity.y >= 0.0:
			break
	var reached: float = start_y - highest
	assert_lt(
		reached, _player.config.max_jump_height() * 0.9,
		"relacher tot doit clairement ecourter le saut"
	)
	assert_gt(reached, 0.0, "le saut doit quand meme avoir lieu")


# --- Le stick ne saute pas --------------------------------------------------

func test_pushing_the_stick_up_never_jumps() -> void:
	# Le haut du stick est branche sur `move_up`, que rien ne consomme. Le
	# saut n'existe QUE sur le bouton A : deux facons de faire la meme chose
	# est une facon de trop a 8 ans.
	assert_true(_player.is_on_floor())
	Input.action_press(&"move_up")
	await _step(6)
	assert_gt(_player.velocity.y, -1.0, "pousser le stick vers le haut ne doit rien declencher")
	assert_true(_player.is_on_floor(), "SORIO doit rester au sol")
	Input.action_release(&"move_up")


# --- Coup porte (bouton B) --------------------------------------------------

func test_attack_activates_the_hitbox_then_stops() -> void:
	assert_false(_player.attack_box.monitoring, "la boite dort au repos")
	assert_true(_player.try_attack())
	assert_true(_player.is_attacking())
	assert_true(_player.attack_box.monitoring, "la boite doit faire mal pendant le coup")
	# Au-dela de la duree active, elle doit se rendormir toute seule.
	await _step(int(ceil(Player.ATTACK_ACTIVE_SECONDS / PHYSICS_STEP)) + 2)
	assert_false(_player.is_attacking())
	assert_false(_player.attack_box.monitoring, "une boite restee active ferait mal a tort")


func test_attack_respects_its_cooldown() -> void:
	assert_true(_player.try_attack())
	assert_false(_player.try_attack(), "on ne peut pas marteler sans limite")
	await _step(int(ceil(Player.ATTACK_COOLDOWN_SECONDS / PHYSICS_STEP)) + 2)
	assert_true(_player.try_attack(), "apres le delai, on peut refrapper")


func test_attack_works_in_the_air() -> void:
	# Un enfant qui appuie sur B doit voir SORIO frapper, meme en plein saut.
	_player.global_position = Vector2(0.0, FLOOR_Y - 300.0)
	await _wait_for_coyote_to_close()
	assert_false(_player.is_on_floor())
	assert_true(_player.try_attack(), "frapper doit marcher en l'air aussi")


func test_attack_always_reaches_in_front() -> void:
	# Le coup part devant, jamais dans le dos.
	Input.action_press(&"move_right")
	await _step(4)
	assert_gt(_player.attack_box.position.x, 0.0)
	Input.action_release(&"move_right")
	Input.action_press(&"move_left")
	await _step(6)
	assert_lt(_player.attack_box.position.x, 0.0)
	Input.action_release(&"move_left")


# --- Le stick ne fait que du lateral ----------------------------------------

func test_stick_vertical_axes_do_nothing() -> void:
	# Ni le haut ni le bas du stick ne declenchent quoi que ce soit : le
	# saut est au bouton A, et l'accroupissement n'existe pas. Sur telephone,
	# un pouce qui derape verticalement sur le stick ne doit jamais changer
	# ce que fait SORIO.
	assert_true(_player.is_on_floor())
	var state_before: StringName = _player.state_machine.current_name
	Input.action_press(&"move_up")
	Input.action_press(&"move_down")
	await _step(8)
	assert_eq(_player.state_machine.current_name, state_before,
		"les axes verticaux du stick ne changent pas d'etat")
	assert_true(_player.is_on_floor())
	assert_gt(_player.velocity.y, -1.0)
	Input.action_release(&"move_up")
	Input.action_release(&"move_down")


# --- Portee, utilisee par le lint des niveaux -------------------------------

func test_config_reach_matches_b4_values() -> void:
	var config: PlayerConfig = _player.config
	# Reperes calcules depuis B.4, sur lesquels `lint_levels` s'appuiera.
	assert_between(config.max_jump_height(), 210.0, 216.0)
	assert_between(config.max_jump_distance(), 298.0, 308.0)
	assert_between(config.max_jump_height_tiles(), 3.2, 3.4)
	assert_between(config.max_jump_distance_tiles(), 4.6, 4.8)


func test_default_config_is_valid() -> void:
	var problems: PackedStringArray = _player.config.validate()
	assert_eq(problems.size(), 0, "PlayerConfig par defaut doit etre valide")


# --- Proportion du parcours (regle 5 de B.6) --------------------------------

func test_every_gap_is_jumpable_with_margin() -> void:
	# Un trou calibre a 100 % de la portee serait franchissable en theorie et
	# injouable en pratique. La marge existe pour qu'un enfant puisse rater
	# legerement son appel et retomber quand meme.
	var config: PlayerConfig = _player.config
	var budget: float = config.max_jump_distance_tiles() * TestLevel.MAX_GAP_RATIO
	var gaps: Array[int] = TestLevel.gap_widths()
	assert_gt(float(gaps.size()), 0.0, "le niveau doit comporter des trous a franchir")
	for gap: int in gaps:
		assert_lt(float(gap), budget + 0.001,
			"trou de %d tuiles pour un budget de %.2f" % [gap, budget])


func test_gaps_are_not_trivially_small() -> void:
	# L'inverse est un defaut aussi : un parcours dont tous les trous font
	# une tuile n'apprend rien et n'amuse personne.
	var widest: int = 0
	for gap: int in TestLevel.gap_widths():
		widest = maxi(widest, gap)
	assert_gt(float(widest), 2.0, "au moins un trou doit demander un vrai saut")


func test_attack_animation_returns_to_the_state_pose() -> void:
	# `cast` ne boucle pas : sans retour explicite, SORIO garderait le bras
	# tendu jusqu'au prochain changement d'etat.
	_player.try_attack()
	await _step(1)
	assert_eq(String(_player.sprite.animation), "cast")
	await _step(int(ceil(Player.ATTACK_ACTIVE_SECONDS / PHYSICS_STEP)) + 3)
	assert_ne(String(_player.sprite.animation), "cast",
		"le bras doit revenir tout seul une fois le coup termine")
	assert_eq(String(_player.sprite.animation),
		String(_player.state_machine.current.get_animation()))


# --- Cadeaux Surprise, en conditions reelles --------------------------------

func test_jumping_into_a_gift_box_opens_it() -> void:
	# Ce cas passe par une VRAIE collision, pas par un appel direct a
	# `head_bump`. C'est ce qui a revele que `move_and_slide()` annule la
	# vitesse verticale a l'impact : lue apres coup, elle valait zero et
	# aucun coup de tete n'etait jamais reconnu.
	var box: GiftBox = (load("res://src/entities/pickups/gift_box.tscn") as PackedScene) \
		.instantiate() as GiftBox
	# Juste au-dessus de la tete de SORIO, largement a portee de saut.
	box.global_position = Vector2(_player.global_position.x, FLOOR_Y - 190.0)
	_world.add_child(box)
	box.setup(_player)
	# On capte le signal plutot que de garder la reference : un cadeau
	# ouvert se libere apres son effet de casse, et l'interroger ensuite
	# reviendrait a lire un noeud detruit.
	var was_opened: Array[bool] = [false]
	box.opened.connect(func(_b: GiftBox) -> void: was_opened[0] = true)
	await _step(2)

	assert_false(was_opened[0], "le cadeau doit commencer ferme")
	Input.action_press(&"jump")
	await _step(30)
	Input.action_release(&"jump")
	assert_true(was_opened[0], "sauter dans un cadeau doit l'ouvrir")


func test_walking_under_a_gift_box_leaves_it_closed() -> void:
	# Passer dessous sans sauter ne doit rien donner, sinon on ramasse tout
	# sans le vouloir et la recompense ne veut plus rien dire.
	var box: GiftBox = (load("res://src/entities/pickups/gift_box.tscn") as PackedScene) \
		.instantiate() as GiftBox
	box.global_position = Vector2(_player.global_position.x + 200.0, FLOOR_Y - 190.0)
	_world.add_child(box)
	box.setup(_player)
	var was_opened: Array[bool] = [false]
	box.opened.connect(func(_b: GiftBox) -> void: was_opened[0] = true)
	await _step(2)

	Input.action_press(&"move_right")
	await _step(45)
	Input.action_release(&"move_right")
	assert_false(was_opened[0], "marcher dessous ne doit pas l'ouvrir")
