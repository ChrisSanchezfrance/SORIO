class_name BackdropLife
extends Node2D
## Ce qui bouge dans le decor : oiseaux, feuilles, herbes (B.10).
##
## Un decor immobile a l'air d'une image. Trois mouvements lents suffisent a
## le rendre vivant, et aucun ne doit attirer l'oeil plus que le jeu : ils
## sont lents, pales, et se produisent LOIN du sol ou SORIO agit.
##
## Tout est dessine en polygones et cercles, comme le reste du decor : aucune
## texture n'entre dans le depot, et un monde se decrit par une palette.

## Vol des oiseaux, en pixels par seconde. Lent : un oiseau rapide devient
## une distraction.
const BIRD_SPEED_MIN: float = 22.0
const BIRD_SPEED_MAX: float = 44.0
const BIRD_COUNT: int = 7
const BIRD_SPAN: float = 15.0
const BIRD_FLAP_HZ: float = 2.4
## Bande de ciel ou les oiseaux evoluent.
const BIRD_TOP: float = 60.0
const BIRD_BOTTOM: float = 300.0

## Feuilles qui tombent. Elles derivent en zigzag, comme de vraies feuilles.
const LEAF_COUNT: int = 16
const LEAF_FALL_MIN: float = 26.0
const LEAF_FALL_MAX: float = 58.0
const LEAF_SWAY_PIXELS: float = 34.0
const LEAF_SWAY_HZ: float = 0.5
const LEAF_SIZE: float = 7.0

## Largeur sur laquelle la vie se repete, calee sur le motif du decor.
const SPAN: float = BackdropShapes.PLANE_WIDTH

var palette: Dictionary = BackdropShapes.PALETTE_WORLD_01

## {position, speed, phase} pour chaque oiseau et chaque feuille.
var _birds: Array[Dictionary] = []
var _leaves: Array[Dictionary] = []
var _time: float = 0.0


func _ready() -> void:
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = 90210
	for i: int in range(BIRD_COUNT):
		_birds.append({
			"position": Vector2(
				rng.randf_range(0.0, SPAN), rng.randf_range(BIRD_TOP, BIRD_BOTTOM)
			),
			"speed": rng.randf_range(BIRD_SPEED_MIN, BIRD_SPEED_MAX),
			"phase": rng.randf_range(0.0, TAU),
			"scale": rng.randf_range(0.7, 1.3),
		})
	for i: int in range(LEAF_COUNT):
		_leaves.append({
			"position": Vector2(
				rng.randf_range(0.0, SPAN), rng.randf_range(-200.0, 620.0)
			),
			"speed": rng.randf_range(LEAF_FALL_MIN, LEAF_FALL_MAX),
			"phase": rng.randf_range(0.0, TAU),
			"spin": rng.randf_range(-1.6, 1.6),
			"warm": rng.randf() < 0.35,
		})


func _process(delta: float) -> void:
	_time += delta
	for bird: Dictionary in _birds:
		var position: Vector2 = bird["position"]
		position.x += float(bird["speed"]) * delta
		if position.x > SPAN:
			position.x -= SPAN
		bird["position"] = position
	for leaf: Dictionary in _leaves:
		var position: Vector2 = leaf["position"]
		position.y += float(leaf["speed"]) * delta
		# Une feuille qui a fini sa chute repart du haut : la boucle est
		# invisible parce que chacune a sa propre vitesse et sa phase.
		if position.y > 680.0:
			position.y = -60.0
		leaf["position"] = position
	queue_redraw()


func _draw() -> void:
	_draw_birds()
	_draw_leaves()


## Un oiseau lointain, c'est deux traits en V qui battent. Vouloir dessiner
## mieux a cette taille ne se verrait pas et couterait des sommets.
func _draw_birds() -> void:
	var ink: Color = Color(palette["ridge_near"]).darkened(0.25)
	ink.a = 0.55
	for bird: Dictionary in _birds:
		var position: Vector2 = bird["position"]
		var scale: float = float(bird["scale"])
		var flap: float = sin(_time * TAU * BIRD_FLAP_HZ + float(bird["phase"]))
		var lift: float = BIRD_SPAN * 0.42 * scale * flap
		var span: float = BIRD_SPAN * scale
		# On dessine deux fois, decale d'un motif, pour que le vol soit
		# continu quand un oiseau franchit le raccord.
		for offset: float in [0.0, -SPAN]:
			var center: Vector2 = position + Vector2(offset, 0.0)
			draw_polyline(PackedVector2Array([
				center + Vector2(-span, -lift),
				center,
				center + Vector2(span, -lift),
			]), ink, 2.5 * scale)


## Feuilles qui descendent en zigzag. Deux verts et un ocre : la variete de
## teinte fait plus pour la richesse que le nombre de feuilles.
func _draw_leaves() -> void:
	for leaf: Dictionary in _leaves:
		var position: Vector2 = leaf["position"]
		var sway: float = sin(_time * TAU * LEAF_SWAY_HZ + float(leaf["phase"]))
		var center: Vector2 = position + Vector2(sway * LEAF_SWAY_PIXELS, 0.0)
		var angle: float = _time * float(leaf["spin"]) + float(leaf["phase"])
		var color: Color = palette["tree_far"] if not bool(leaf["warm"]) \
			else Color(0.86, 0.62, 0.24)
		color.a = 0.75

		# Une feuille : un losange etire, incline, qui tourne en tombant.
		var long_axis: Vector2 = Vector2(cos(angle), sin(angle)) * LEAF_SIZE * 1.7
		var short_axis: Vector2 = Vector2(-sin(angle), cos(angle)) * LEAF_SIZE * 0.62
		draw_colored_polygon(PackedVector2Array([
			center - long_axis,
			center - short_axis,
			center + long_axis,
			center + short_axis,
		]), color)
