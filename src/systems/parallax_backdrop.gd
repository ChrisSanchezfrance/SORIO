class_name ParallaxBackdrop
extends CanvasLayer
## Decor de fond a 4 plans (B.10).
##
## ciel lointain (x0,04) -> nuages (x0,12) -> montagnes et volcan (x0,30)
## -> vegetation d'arriere-plan (x0,60) -> plateformes jouables (x1,0).
##
## Tout est construit en `Polygon2D` : aucun pixel n'est calcule, aucune
## texture de decor n'est stockee dans le depot, et le decor d'un monde tient
## dans une palette plus quelques nombres (voir `BackdropShapes`).
##
## Le nombre de plans affiches vient de `Perf.parallax_layers()` : 4 au
## palier haut, 3 au moyen, 2 au bas (B.11). Les premiers sacrifies sont ceux
## qui apportent le moins a la lecture du niveau — les nuages avant les
## arbres, jamais l'inverse.
##
## Le decor vit dans un `CanvasLayer` en espace ecran : il ne suit pas la
## camera verticalement. Pour un niveau majoritairement horizontal c'est le
## bon choix, et ca evite qu'un saut fasse plonger tout l'horizon.

## Derriere tout le reste : le jeu est en couche 0.
const LAYER_INDEX: int = -10
## Hauteur de reference de la mise en page ci-dessous.
const DESIGN_HEIGHT: float = 720.0

## Ligne d'horizon : ou se posent montagnes et foret.
const HORIZON_Y: float = 470.0

## `scroll` : facteur de defilement. `drift` : defilement automatique.
## `from_tier` : nombre de plans a partir duquel ce plan apparait.
const CLOUD_SCROLL: float = 0.12
const CLOUD_DRIFT: float = -6.0
const MOUNTAIN_SCROLL: float = 0.30
const FOREST_SCROLL: float = 0.60

var palette: Dictionary = BackdropShapes.PALETTE_WORLD_01

var _sky: TextureRect = null
var _sun: TextureRect = null
var _clouds: Parallax2D = null
var _mountains: Parallax2D = null
var _forest: Parallax2D = null


func _ready() -> void:
	layer = LAYER_INDEX
	_build_sky()
	_clouds = _build_clouds()
	_mountains = _build_mountains()
	_forest = _build_forest()
	EventBus.quality_tier_changed.connect(_on_quality_changed)
	_apply_quality(Perf.parallax_layers())


# --- Plan 1 : ciel et soleil ------------------------------------------------

func _build_sky() -> void:
	# Etire au viewport : couvre n'importe quel format de telephone, du 16:9
	# au 20:9, sans bande vide.
	_sky = TextureRect.new()
	_sky.name = "Sky"
	_sky.texture = BackdropShapes.sky_gradient(palette)
	_sky.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_sky.stretch_mode = TextureRect.STRETCH_SCALE
	_sky.set_anchors_preset(Control.PRESET_FULL_RECT)
	_sky.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_sky)

	# Le soleil dit "plein jour" d'un coup d'oeil, sans qu'on ait a l'ecrire.
	_sun = TextureRect.new()
	_sun.name = "Sun"
	_sun.texture = BackdropShapes.sun_texture(palette)
	_sun.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_sun.stretch_mode = TextureRect.STRETCH_SCALE
	_sun.position = Vector2(120.0, 30.0)
	_sun.size = Vector2(280.0, 280.0)
	_sun.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_sun)


# --- Plan 2 : nuages --------------------------------------------------------

func _build_clouds() -> Parallax2D:
	var plane: Parallax2D = _new_plane("Clouds", CLOUD_SCROLL, CLOUD_DRIFT)
	for cluster: Dictionary in BackdropShapes.cloud_clusters():
		var center: Vector2 = cluster["center"]
		var puffs: Array = cluster["puffs"]
		# Deux passes : l'ombre decalee vers le bas, puis le blanc par-dessus.
		# Le nuage prend du volume sans qu'on lui dessine de contour.
		_add_puffs(plane, center + Vector2(0.0, 10.0), puffs, palette["cloud_shade"])
		_add_puffs(plane, center, puffs, palette["cloud"])
	return plane


func _add_puffs(
	plane: Parallax2D, center: Vector2, puffs: Array, color: Color
) -> void:
	for puff: Dictionary in puffs:
		_add_polygon(
			plane,
			BackdropShapes.circle_polygon(
				center + Vector2(puff["offset"]), float(puff["radius"])
			),
			color
		)


# --- Plan 3 : montagnes et volcan -------------------------------------------

func _build_mountains() -> Parallax2D:
	var plane: Parallax2D = _new_plane("Mountains", MOUNTAIN_SCROLL, 0.0)
	var floor_y: float = DESIGN_HEIGHT

	# Deux cretes : la claire derriere, la sombre devant. C'est ce decalage
	# qui donne la profondeur, pas un dessin plus detaille.
	_add_polygon(plane, BackdropShapes.ridge_polygon(
		HORIZON_Y - 96.0, floor_y, [[3, 34.0, 0.0], [7, 16.0, 1.3], [11, 8.0, 2.6]]
	), palette["ridge_far"])
	_add_polygon(plane, BackdropShapes.ridge_polygon(
		HORIZON_Y - 34.0, floor_y, [[2, 46.0, 0.9], [5, 22.0, 2.1], [9, 10.0, 0.4]]
	), palette["ridge_near"])

	# Volcan a droite, loin des bords : aucun raccord a gerer a la repetition.
	# Pente raide et sommet bas : un volcan trop evase mangeait la moitie de
	# l'ecran et ecrasait la zone de jeu. Il doit dominer l'horizon, pas la
	# scene.
	const APEX: Vector2 = Vector2(900.0, 206.0)
	const SLOPE: float = 1.65
	const CRATER_HALF: float = 26.0
	_add_polygon(plane, BackdropShapes.volcano_polygon(
		APEX, SLOPE, CRATER_HALF, floor_y
	), palette["volcano"])
	# Flanc droit assombri : un simple aplat plus sombre suffit a donner du
	# relief a la silhouette.
	# Le flanc droit reste dans l'ombre : un aplat plus sombre suffit a
	# donner du relief sans dessiner de degrade.
	_add_polygon(plane, PackedVector2Array([
		Vector2(APEX.x + CRATER_HALF, APEX.y + CRATER_HALF * SLOPE),
		Vector2(APEX.x + (floor_y - APEX.y) / SLOPE, floor_y),
		Vector2(APEX.x + CRATER_HALF, floor_y),
	]), palette["volcano_dark"])
	_add_polygon(plane, BackdropShapes.crater_polygon(
		APEX, SLOPE, CRATER_HALF
	), palette["volcano_lit"])

	for puff: Dictionary in BackdropShapes.smoke_puffs(APEX, CRATER_HALF, SLOPE):
		var smoke: Color = palette["smoke"]
		smoke.a = float(puff["alpha"])
		_add_polygon(plane, BackdropShapes.circle_polygon(
			puff["center"], float(puff["radius"])
		), smoke)
	return plane


# --- Plan 4 : vegetation d'arriere-plan -------------------------------------

func _build_forest() -> Parallax2D:
	var plane: Parallax2D = _new_plane("Forest", FOREST_SCROLL, 0.0)
	var floor_y: float = DESIGN_HEIGHT

	# Rangee lointaine, claire ; puis rangee proche, sombre et plus haute.
	_add_tree_row(plane, BackdropShapes.tree_row(HORIZON_Y + 10.0, 46.0, 148.0, 11),
		palette["tree_far"], floor_y)
	_add_tree_row(plane, BackdropShapes.tree_row(HORIZON_Y + 54.0, 62.0, 196.0, 23),
		palette["tree_near"], floor_y)

	# Litiere : une bande pleine qui ferme le plan par le bas et empeche de
	# voir le ciel sous les arbres.
	_add_polygon(plane, PackedVector2Array([
		Vector2(0.0, HORIZON_Y + 86.0),
		Vector2(BackdropShapes.PLANE_WIDTH, HORIZON_Y + 86.0),
		Vector2(BackdropShapes.PLANE_WIDTH, floor_y),
		Vector2(0.0, floor_y),
	]), palette["tree_near"])
	return plane


func _add_tree_row(
	plane: Parallax2D, trees: Array[Dictionary], canopy: Color, floor_y: float
) -> void:
	for tree: Dictionary in trees:
		_add_polygon(plane, BackdropShapes.trunk_polygon(tree, floor_y), palette["trunk"])
	# Les houppiers passent apres tous les troncs, sinon un tronc voisin
	# viendrait se dessiner par-dessus le feuillage.
	for tree: Dictionary in trees:
		for circle: PackedVector2Array in BackdropShapes.canopy_circles(tree):
			_add_polygon(plane, circle, canopy)


# --- Fabrique ---------------------------------------------------------------

func _new_plane(name: String, scroll: float, drift: float) -> Parallax2D:
	var plane: Parallax2D = Parallax2D.new()
	plane.name = name
	plane.scroll_scale = Vector2(scroll, 0.0)
	# Repetition horizontale infinie. Les silhouettes sont construites pour
	# se raccorder exactement au bord (voir BackdropShapes).
	plane.repeat_size = Vector2(BackdropShapes.PLANE_WIDTH, 0.0)
	plane.repeat_times = 3
	plane.autoscroll = Vector2(drift, 0.0)
	add_child(plane)
	return plane


func _add_polygon(parent: Node, points: PackedVector2Array, color: Color) -> void:
	var polygon: Polygon2D = Polygon2D.new()
	polygon.polygon = points
	polygon.color = color
	parent.add_child(polygon)


# --- Qualite ----------------------------------------------------------------

func _on_quality_changed(_tier: int) -> void:
	_apply_quality(Perf.parallax_layers())


## `available` vaut 4, 3 ou 2 : le nombre TOTAL de plans, ciel compris.
func _apply_quality(available: int) -> void:
	# Le ciel ne disparait jamais : sans lui le fond serait vide.
	# Puis on garde la foret, puis les montagnes, et les nuages en dernier.
	if _forest != null:
		_forest.visible = available >= 2
	if _mountains != null:
		_mountains.visible = available >= 3
	if _clouds != null:
		_clouds.visible = available >= 4


## Nombre de plans visibles, lu par les tests.
func visible_plane_count() -> int:
	var count: int = 1
	for plane: Parallax2D in [_clouds, _mountains, _forest]:
		if plane != null and plane.visible:
			count += 1
	return count
