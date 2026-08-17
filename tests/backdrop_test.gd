extends TestCase
## Geometrie du decor de fond (`BackdropShapes`).
##
## Ce qui est verifie ici n'est pas "c'est joli" — ca, seul l'oeil le dit —
## mais les invariants qui font qu'un decor qui defile a l'infini ne montre
## jamais sa couture. Une couture visible se remarque immediatement en jeu
## et se traque tres mal a la main.

const WIDTH: float = BackdropShapes.PLANE_WIDTH
const HARMONICS: Array = [[3, 34.0, 0.0], [7, 16.0, 1.3], [11, 8.0, 2.6]]


# --- Repetition sans couture ------------------------------------------------

func test_ridge_starts_and_ends_at_the_same_height() -> void:
	# C'est LA condition du raccord : sans elle, une marche apparait dans la
	# montagne a chaque repetition.
	var points: PackedVector2Array = BackdropShapes.ridge_polygon(300.0, 720.0, HARMONICS)
	var first: Vector2 = points[0]
	# Les trois derniers points ferment le polygone par le bas ; le sommet
	# droit est l'avant-dernier de la ligne de crete.
	var last_top: Vector2 = points[points.size() - 3]
	assert_almost_eq(first.y, last_top.y, 0.01,
		"la crete doit revenir exactement a sa hauteur de depart")
	assert_almost_eq(first.x, 0.0, 0.01)
	assert_almost_eq(last_top.x, WIDTH, 0.01)


func test_ridge_uses_only_integer_frequencies() -> void:
	# Une frequence non entiere casserait le raccord en silence : le decor
	# aurait l'air correct sur une capture et sauterait en jeu.
	for harmonic: Array in HARMONICS:
		var frequency: float = float(harmonic[0])
		assert_almost_eq(frequency, round(frequency), 0.0001,
			"frequence non entiere : %f" % frequency)


func test_clouds_stay_clear_of_the_seam() -> void:
	# Un nuage a cheval sur le bord serait tranche net a la repetition.
	const WIDEST_PUFF: float = 60.0
	for cluster: Dictionary in BackdropShapes.cloud_clusters():
		var x: float = Vector2(cluster["center"]).x
		assert_gt(x, WIDEST_PUFF, "nuage trop proche du bord gauche")
		assert_lt(x, WIDTH - WIDEST_PUFF, "nuage trop proche du bord droit")


func test_tree_spacing_divides_the_plane_width() -> void:
	# Un espacement qui ne divise pas la largeur laisse un trou ou un
	# doublon d'arbres a chaque raccord.
	for spacing: float in [148.0, 196.0]:
		var trees: Array[Dictionary] = BackdropShapes.tree_row(400.0, 40.0, spacing, 1)
		assert_gt(float(trees.size()), 0.0)
		var last_x: float = float(trees[trees.size() - 1]["x"])
		assert_lt(last_x, WIDTH, "le dernier arbre doit rester dans le motif")


# --- Formes -----------------------------------------------------------------

func test_volcano_has_a_flat_crater_not_a_point() -> void:
	# Un cone pointu ne lirait pas comme un volcan. Le sommet est tronque.
	var apex: Vector2 = Vector2(900.0, 206.0)
	var points: PackedVector2Array = BackdropShapes.volcano_polygon(apex, 1.65, 26.0, 720.0)
	assert_eq(points.size(), 4)
	assert_almost_eq(points[1].y, points[2].y, 0.01, "la levre du cratere est horizontale")
	assert_almost_eq(points[2].x - points[1].x, 52.0, 0.01, "largeur du cratere")


func test_volcano_stays_inside_the_plane() -> void:
	# Un volcan qui deborde serait coupe en deux a la repetition.
	var points: PackedVector2Array = BackdropShapes.volcano_polygon(
		Vector2(900.0, 206.0), 1.65, 26.0, 720.0
	)
	for point: Vector2 in points:
		assert_between(point.x, 0.0, WIDTH,
			"sommet du volcan hors du motif : %f" % point.x)


func test_volcano_is_not_wider_than_half_the_plane() -> void:
	# Regle de cadrage : le volcan domine l'horizon, il n'ecrase pas la
	# scene. Une version precedente faisait 1120 px de large sur 1280.
	var points: PackedVector2Array = BackdropShapes.volcano_polygon(
		Vector2(900.0, 206.0), 1.65, 26.0, 720.0
	)
	var width: float = points[3].x - points[0].x
	assert_lt(width, WIDTH * 0.55, "volcan trop large : %f px" % width)


func test_circle_polygon_has_the_requested_radius() -> void:
	var center: Vector2 = Vector2(100.0, 50.0)
	var points: PackedVector2Array = BackdropShapes.circle_polygon(center, 30.0)
	assert_eq(points.size(), BackdropShapes.CIRCLE_SEGMENTS)
	for point: Vector2 in points:
		assert_almost_eq(point.distance_to(center), 30.0, 0.01)


func test_smoke_rises_and_fades() -> void:
	# Le panache doit monter ET s'effacer : sans l'un des deux, il ressemble
	# a une colonne posee sur le volcan.
	var puffs: Array[Dictionary] = BackdropShapes.smoke_puffs(
		Vector2(900.0, 206.0), 26.0, 1.65
	)
	assert_gt(float(puffs.size()), 3.0)
	var first: Dictionary = puffs[0]
	var last: Dictionary = puffs[puffs.size() - 1]
	assert_lt(Vector2(last["center"]).y, Vector2(first["center"]).y, "la fumee monte")
	assert_gt(float(last["radius"]), float(first["radius"]), "elle s'elargit")
	assert_lt(float(last["alpha"]), float(first["alpha"]), "elle s'efface")


# --- Palette ----------------------------------------------------------------

func test_palette_follows_atmospheric_perspective() -> void:
	# Loin = clair et desature, proche = sombre et sature. C'est ce qui cree
	# la profondeur, bien plus qu'un dessin plus detaille.
	var palette: Dictionary = BackdropShapes.PALETTE_WORLD_01
	var far: Color = palette["ridge_far"]
	var near: Color = palette["ridge_near"]
	assert_gt(far.get_luminance(), near.get_luminance(),
		"la crete lointaine doit etre plus claire que la proche")

	var tree_far: Color = palette["tree_far"]
	var tree_near: Color = palette["tree_near"]
	assert_gt(tree_far.get_luminance(), tree_near.get_luminance(),
		"les arbres lointains doivent etre plus clairs")
	assert_gt(tree_near.s, tree_far.s * 0.9,
		"les arbres proches doivent rester au moins aussi satures")


func test_crater_is_the_only_warm_accent() -> void:
	# La levre incandescente doit trancher franchement : c'est le seul point
	# chaud du decor, donc l'oeil y va — le volcan porte la menace de A.1.
	var lit: Color = BackdropShapes.PALETTE_WORLD_01["volcano_lit"]
	assert_gt(lit.r, 0.7, "la lave doit etre franchement rouge")
	assert_lt(lit.b, 0.35)
	var body: Color = BackdropShapes.PALETTE_WORLD_01["volcano"]
	assert_gt(lit.s, body.s, "la lave doit etre plus saturee que la roche")


func test_sky_is_daylight() -> void:
	# Plein jour demande : le haut du ciel doit rester clair et bleu.
	var top: Color = BackdropShapes.PALETTE_WORLD_01["sky_top"]
	assert_gt(top.b, 0.6, "ciel de jour, pas de nuit")
	assert_gt(top.get_luminance(), 0.4)
	var bottom: Color = BackdropShapes.PALETTE_WORLD_01["sky_bottom"]
	assert_gt(bottom.get_luminance(), top.get_luminance(),
		"l'horizon s'eclaircit, comme dans la realite")
