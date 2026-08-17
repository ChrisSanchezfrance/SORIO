class_name BackdropShapes
extends RefCounted
## Geometrie et palettes du decor de fond (B.10).
##
## Ce fichier ne dessine aucun pixel : il ne produit que des polygones, que
## le GPU remplit ensuite via des `Polygon2D`. Une premiere version peignait
## le decor image par image et bloquait plusieurs minutes — en GDScript,
## ecrire dans un `PackedByteArray` membre recopie le tableau a chaque
## affectation. Des polygones sont plus rapides a produire, plus legers en
## memoire, plus nets a l'ecran, et collent au style demande : formes
## arrondies, contours nets, couleurs saturees.
##
## Les silhouettes se repetent sans couture parce qu'elles sont definies par
## des sommes de sinus a frequence ENTIERE sur la largeur : une telle courbe
## revient exactement a sa valeur de depart au bord droit.

## Largeur d'un motif avant repetition.
const PLANE_WIDTH: float = 1280.0

## Vallee des Fougeres (A.4) : verts vifs, ciel turquoise.
## Le degrade du lointain vers le proche suit la perspective atmospherique —
## loin = clair, desature, bleute ; proche = sombre et sature.
const PALETTE_WORLD_01: Dictionary = {
	"sky_top": Color(0.24, 0.66, 0.86),
	"sky_bottom": Color(0.83, 0.95, 0.97),
	"sun": Color(1.00, 0.96, 0.76),
	"cloud": Color(1.00, 1.00, 1.00),
	"cloud_shade": Color(0.80, 0.89, 0.96),
	"ridge_far": Color(0.61, 0.74, 0.87),
	"ridge_near": Color(0.44, 0.58, 0.75),
	"volcano": Color(0.42, 0.38, 0.50),
	"volcano_dark": Color(0.33, 0.30, 0.42),
	"volcano_lit": Color(0.92, 0.36, 0.16),
	"smoke": Color(0.86, 0.87, 0.90),
	"tree_far": Color(0.45, 0.70, 0.35),
	"tree_near": Color(0.19, 0.45, 0.22),
	"trunk": Color(0.27, 0.19, 0.13),
}

## Nombre de cotes d'un cercle approxime. 14 suffit : a l'echelle du decor
## on ne distingue pas un quatorze-gone d'un cercle.
const CIRCLE_SEGMENTS: int = 14


## Crete de montagne : courbe fermee par le bas, tuilable par construction.
## `harmonics` est une liste de [frequence entiere, amplitude, phase].
static func ridge_polygon(
	base_y: float, height: float, harmonics: Array, step: float = 8.0
) -> PackedVector2Array:
	var points: PackedVector2Array = PackedVector2Array()
	var x: float = 0.0
	while x <= PLANE_WIDTH:
		points.append(Vector2(x, _ridge_y(x, base_y, harmonics)))
		x += step
	# Le dernier point retombe exactement sur la valeur du premier.
	points.append(Vector2(PLANE_WIDTH, _ridge_y(0.0, base_y, harmonics)))
	points.append(Vector2(PLANE_WIDTH, height))
	points.append(Vector2(0.0, height))
	return points


static func _ridge_y(x: float, base_y: float, harmonics: Array) -> float:
	var t: float = x / PLANE_WIDTH
	var y: float = base_y
	for harmonic: Array in harmonics:
		y -= float(harmonic[1]) * sin(TAU * float(harmonic[0]) * t + float(harmonic[2]))
	return y


## Le volcan de A.4 : un cone au sommet tronque par le cratere.
static func volcano_polygon(
	apex: Vector2, slope: float, crater_half: float, height: float
) -> PackedVector2Array:
	var lip_y: float = apex.y + crater_half * slope
	var half_base: float = (height - apex.y) / slope
	return PackedVector2Array([
		Vector2(apex.x - half_base, height),
		Vector2(apex.x - crater_half, lip_y),
		Vector2(apex.x + crater_half, lip_y),
		Vector2(apex.x + half_base, height),
	])


## Levre incandescente du cratere : la seule tache chaude du decor, donc
## l'oeil y va tout de suite. C'est voulu — le volcan porte la menace de A.1.
static func crater_polygon(
	apex: Vector2, slope: float, crater_half: float
) -> PackedVector2Array:
	var lip_y: float = apex.y + crater_half * slope
	return PackedVector2Array([
		Vector2(apex.x - crater_half, lip_y),
		Vector2(apex.x + crater_half, lip_y),
		Vector2(apex.x + crater_half * 0.7, lip_y + 12.0),
		Vector2(apex.x - crater_half * 0.7, lip_y + 12.0),
	])


static func circle_polygon(
	center: Vector2, radius: float, segments: int = CIRCLE_SEGMENTS
) -> PackedVector2Array:
	var points: PackedVector2Array = PackedVector2Array()
	for i: int in range(segments):
		var angle: float = TAU * float(i) / float(segments)
		points.append(center + Vector2(cos(angle), sin(angle)) * radius)
	return points


## Bouffees de fumee au-dessus du cratere : elles montent, s'elargissent et
## s'effacent. Retourne une liste de {center, radius, alpha}.
static func smoke_puffs(apex: Vector2, crater_half: float, slope: float) -> Array[Dictionary]:
	var lip_y: float = apex.y + crater_half * slope
	var puffs: Array[Dictionary] = []
	var rng: RandomNumberGenerator = _seeded_rng(4242)
	for i: int in range(10):
		var t: float = float(i) / 9.0
		puffs.append({
			"center": Vector2(
				apex.x + t * 92.0 + rng.randf_range(-14.0, 14.0),
				lip_y - 24.0 - t * 108.0
			),
			"radius": 16.0 + t * 30.0,
			"alpha": 0.42 * (1.0 - t * 0.85),
		})
	return puffs


## Amas de nuages. Chaque amas est une liste de bouffees ; deux passes de
## couleur (ombre puis clair) leur donnent du volume sans contour dessine.
## Les amas restent a l'ecart des bords pour que la repetition ne coupe
## jamais un nuage en deux.
static func cloud_clusters() -> Array[Dictionary]:
	var clusters: Array[Dictionary] = []
	var rng: RandomNumberGenerator = _seeded_rng(20250817)
	const MARGIN: float = 150.0
	for i: int in range(6):
		var center: Vector2 = Vector2(
			rng.randf_range(MARGIN, PLANE_WIDTH - MARGIN),
			rng.randf_range(48.0, 210.0)
		)
		var scale: float = rng.randf_range(0.72, 1.35)
		var puffs: Array[Dictionary] = []
		for p: int in range(rng.randi_range(4, 6)):
			puffs.append({
				"offset": Vector2(
					rng.randf_range(-54.0, 54.0) * scale,
					rng.randf_range(-12.0, 12.0) * scale
				),
				"radius": rng.randf_range(22.0, 40.0) * scale,
			})
		clusters.append({"center": center, "puffs": puffs, "scale": scale})
	return clusters


## Positions et tailles d'une rangee d'arbres. `spacing` divise la largeur,
## ce qui garantit un raccord propre a la repetition.
static func tree_row(
	base_y: float, radius: float, spacing: float, seed_value: int
) -> Array[Dictionary]:
	var trees: Array[Dictionary] = []
	var rng: RandomNumberGenerator = _seeded_rng(seed_value)
	var count: int = int(PLANE_WIDTH / spacing)
	for i: int in range(count):
		trees.append({
			"x": float(i) * spacing + spacing * 0.5,
			"base_y": base_y,
			"radius": radius * (1.0 + rng.randf_range(-0.16, 0.16)),
		})
	return trees


## Houppier d'un arbre : quatre bouffees, plus large en bas, une plus haute.
static func canopy_circles(tree: Dictionary) -> Array[PackedVector2Array]:
	var x: float = float(tree["x"])
	var base_y: float = float(tree["base_y"])
	var r: float = float(tree["radius"])
	return [
		circle_polygon(Vector2(x, base_y - r * 0.35), r),
		circle_polygon(Vector2(x - r * 0.58, base_y - r * 0.05), r * 0.70),
		circle_polygon(Vector2(x + r * 0.58, base_y - r * 0.05), r * 0.70),
		circle_polygon(Vector2(x, base_y - r * 1.05), r * 0.64),
	]


static func trunk_polygon(tree: Dictionary, bottom_y: float) -> PackedVector2Array:
	var x: float = float(tree["x"])
	var half: float = maxf(5.0, float(tree["radius"]) * 0.16)
	return PackedVector2Array([
		Vector2(x - half, float(tree["base_y"]) - half),
		Vector2(x + half, float(tree["base_y"]) - half),
		Vector2(x + half, bottom_y),
		Vector2(x - half, bottom_y),
	])


## Degrade vertical du ciel, construit cote moteur : aucun pixel n'est
## calcule en GDScript.
static func sky_gradient(palette: Dictionary) -> GradientTexture2D:
	var gradient: Gradient = Gradient.new()
	gradient.set_color(0, palette["sky_top"])
	gradient.set_color(1, palette["sky_bottom"])
	# Le ciel s'eclaircit plus vite pres de l'horizon, comme dans la realite.
	gradient.add_point(0.62, Color(palette["sky_top"]).lerp(palette["sky_bottom"], 0.55))

	var texture: GradientTexture2D = GradientTexture2D.new()
	texture.gradient = gradient
	texture.width = 8
	texture.height = 256
	texture.fill_from = Vector2(0.0, 0.0)
	texture.fill_to = Vector2(0.0, 1.0)
	return texture


## Halo radial du soleil.
static func sun_texture(palette: Dictionary) -> GradientTexture2D:
	var gradient: Gradient = Gradient.new()
	var core: Color = palette["sun"]
	gradient.set_color(0, core)
	gradient.set_color(1, Color(core.r, core.g, core.b, 0.0))
	gradient.add_point(0.32, core)
	gradient.add_point(0.46, Color(core.r, core.g, core.b, 0.35))

	var texture: GradientTexture2D = GradientTexture2D.new()
	texture.gradient = gradient
	texture.width = 256
	texture.height = 256
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	return texture


static func _seeded_rng(seed_value: int) -> RandomNumberGenerator:
	# Graine fixe : le meme decor d'une machine a l'autre, donc un depot
	# reproductible et des captures comparables entre deux passes.
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = seed_value
	return rng
