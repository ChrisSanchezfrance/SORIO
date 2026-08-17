extends TestCase
## Cadeaux Surprise et objets absorbes (A.6).
##
## Ce qui compte ici : les TROIS facons d'ouvrir un cadeau marchent toutes,
## et l'objet rejoint toujours SORIO. Un cadeau qui ne s'ouvre que d'une
## seule maniere bloque l'enfant qui n'a pas trouve celle-la.

const GIFT_BOX_SCENE: String = "res://src/entities/pickups/gift_box.tscn"
const PICKUP_SCENE: String = "res://src/entities/pickups/pickup.tscn"

var _world: Node2D = null
var _box: GiftBox = null
var _player_stub: Node2D = null


func before_each() -> void:
	_world = Node2D.new()
	tree.root.add_child(_world)

	# Une simple cible suffit : le cadeau n'a besoin que d'une position.
	_player_stub = Node2D.new()
	_player_stub.global_position = Vector2(0.0, 400.0)
	_world.add_child(_player_stub)

	_box = (load(GIFT_BOX_SCENE) as PackedScene).instantiate() as GiftBox
	_box.global_position = Vector2(0.0, 200.0)
	_world.add_child(_box)
	_box.setup(_player_stub)
	await tree.process_frame


func after_each() -> void:
	if is_instance_valid(_world):
		_world.queue_free()
	_world = null
	_box = null
	_player_stub = null


func _pickups() -> Array[Node]:
	var found: Array[Node] = []
	for child: Node in _world.get_children():
		if child is Pickup:
			found.append(child)
	return found


# --- Les trois facons d'ouvrir ----------------------------------------------

func test_head_bump_opens_the_box() -> void:
	# On saute dedans : vitesse verticale franchement negative.
	assert_true(_box.head_bump(-400.0))
	assert_true(_box.is_open())


func test_a_slow_touch_from_below_does_not_open() -> void:
	# Marcher sous un cadeau ne doit pas l'ouvrir : sinon on ramasse tout
	# sans le vouloir et la recompense ne veut plus rien dire.
	assert_false(_box.head_bump(0.0))
	assert_false(_box.is_open())


func test_falling_onto_the_box_does_not_open_it() -> void:
	# Atterrir dessus, c'est une plateforme, pas un coup.
	assert_false(_box.head_bump(500.0))
	assert_false(_box.is_open())


func test_attack_opens_the_box() -> void:
	assert_true(_box.hit(&"attack"))
	assert_true(_box.is_open())


func test_power_opens_the_box() -> void:
	# Les pouvoirs passent par la meme porte que le coup : tout ce qui vient
	# du joueur ouvre le cadeau. En passe 4, aucun code a changer ici.
	assert_true(_box.hit(&"power"))
	assert_true(_box.is_open())


func test_an_open_box_cannot_be_opened_twice() -> void:
	assert_true(_box.hit(&"attack"))
	assert_false(_box.hit(&"attack"), "un cadeau vide ne redonne rien")
	assert_false(_box.head_bump(-400.0))


func test_a_tougher_box_needs_several_hits() -> void:
	_box.hits_required = 3
	_box._remaining_hits = 3
	assert_false(_box.hit(&"attack"))
	assert_false(_box.hit(&"attack"))
	assert_true(_box.hit(&"attack"), "le troisieme coup ouvre")


# --- Contenu ----------------------------------------------------------------

func test_opening_spawns_the_contents() -> void:
	_box.content_count = 3
	_box.hit(&"attack")
	await tree.process_frame
	assert_eq(_pickups().size(), 3, "trois objets doivent jaillir")


func test_contents_spread_out() -> void:
	# Trois objets partis exactement du meme point ressemblent a un seul.
	_box.content_count = 3
	_box.hit(&"attack")
	await tree.process_frame
	var xs: Array[float] = []
	for pickup: Node in _pickups():
		xs.append((pickup as Node2D).global_position.x)
	assert_eq(xs.size(), 3)
	assert_ne(xs[0], xs[2], "les objets doivent s'ecarter en eventail")


func test_contents_receive_the_player_as_target() -> void:
	_box.hit(&"attack")
	await tree.process_frame
	for pickup: Node in _pickups():
		assert_eq((pickup as Pickup).target, _player_stub,
			"chaque objet doit savoir vers qui aller")


func test_box_stops_being_solid_once_opened() -> void:
	_box.hit(&"attack")
	await tree.process_frame
	assert_eq(_box.collision_layer, 0,
		"rester bloque sur un cadeau ouvert serait incomprehensible")


# --- L'objet rejoint SORIO --------------------------------------------------

func test_pickup_flies_to_the_player_and_is_absorbed() -> void:
	var pickup: Pickup = (load(PICKUP_SCENE) as PackedScene).instantiate() as Pickup
	_world.add_child(pickup)
	pickup.launch(Vector2(0.0, 200.0), _player_stub, 0.0)

	var before: int = Game.save.amber
	# Le temps de jaillir puis de foncer sur la cible.
	for i: int in range(180):
		await tree.physics_frame
		if not is_instance_valid(pickup):
			break
	assert_false(is_instance_valid(pickup), "l'objet doit avoir ete absorbe")
	assert_gt(float(Game.save.amber), float(before),
		"l'absorption doit crediter le joueur")


func test_pickup_without_target_does_not_live_forever() -> void:
	# Filet de securite : un objet orphelin ne doit pas rester dans le niveau.
	var pickup: Pickup = (load(PICKUP_SCENE) as PackedScene).instantiate() as Pickup
	_world.add_child(pickup)
	pickup.launch(Vector2(0.0, 200.0), null, 0.0)
	for i: int in range(120):
		await tree.physics_frame
		if not is_instance_valid(pickup):
			break
	assert_false(is_instance_valid(pickup))


func test_pickup_reaches_a_running_player() -> void:
	# L'objet accelere : il doit rattraper SORIO meme s'il continue de courir.
	var pickup: Pickup = (load(PICKUP_SCENE) as PackedScene).instantiate() as Pickup
	_world.add_child(pickup)
	pickup.launch(Vector2(0.0, 200.0), _player_stub, 0.0)
	for i: int in range(240):
		await tree.physics_frame
		if not is_instance_valid(_player_stub):
			break
		# La cible fuit a la vitesse de course de SORIO.
		_player_stub.global_position.x += 440.0 / 60.0
		if not is_instance_valid(pickup):
			break
	assert_false(is_instance_valid(pickup),
		"un objet qui n'accelere pas assez ne rattraperait jamais le joueur")
