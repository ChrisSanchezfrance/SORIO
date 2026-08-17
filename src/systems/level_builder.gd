class_name LevelBuilder
extends RefCounted
## Construit un niveau a partir d'un fichier ASCII (B.6).
##
## C'est la decision d'architecture centrale du projet : un niveau est un
## `.txt` lisible, modifiable et versionnable, jamais un dessin dans
## l'editeur. Ce fichier le lit et fabrique le monde a l'execution.
##
## Format : un en-tete entre deux lignes `---`, puis la grille.
##
##     ---
##     name: LEVEL_1_1_NAME
##     time_limit: 120
##     ---
##     ..S.....?......F..
##     ##################

const TILE: int = 64

## Legende de B.6. Tout caractere absent d'ici est signale au chargement.
const SOLID: String = "#"
const ONE_WAY: String = "="
const EMPTY: String = "."
const SPAWN: String = "S"
const FLAG: String = "F"
const CHECKPOINT: String = "C"
const GIFT: String = "?"
const AMBER: String = "o"
const HIDDEN_AMBER: String = "A"
const SPIKE: String = "^"

## Lettre -> identifiant d'ennemi (A.7).
const ENEMIES: Dictionary = {
	"r": &"raptoz",
	"g": &"gueule_piege",
	"p": &"pterodard",
	"c": &"compso",
	"t": &"tricrash",
	"j": &"bourgeon",
}

const GIFT_SCENE: String = "res://src/entities/pickups/gift_box.tscn"
const PICKUP_SCENE: String = "res://src/entities/pickups/pickup.tscn"
const ENEMY_SCENE: String = "res://src/entities/enemies/enemy.tscn"

## Resultat de la construction.
class Result extends RefCounted:
	var header: Dictionary = {}
	var grid: Array[String] = []
	var spawn: Vector2 = Vector2.ZERO
	var flag: Vector2 = Vector2.ZERO
	var checkpoints: Array[Vector2] = []
	var solids: Array[Rect2] = []
	var one_ways: Array[Rect2] = []
	var spikes: Array[Rect2] = []
	var errors: PackedStringArray = PackedStringArray()

	func width_pixels() -> float:
		return float(grid[0].length() * TILE) if not grid.is_empty() else 0.0

	func height_pixels() -> float:
		return float(grid.size() * TILE)


## Lit un fichier de niveau et retourne son contenu analyse.
static func parse(path: String) -> Result:
	var result: Result = Result.new()
	if not FileAccess.file_exists(path):
		result.errors.append("fichier introuvable : %s" % path)
		return result

	var text: String = FileAccess.get_file_as_string(path)
	var lines: PackedStringArray = text.split("\n")
	var in_header: bool = false
	var header_done: bool = false

	for raw: String in lines:
		var line: String = raw.strip_edges(false, true)
		if line.begins_with("---"):
			if not header_done:
				in_header = not in_header
				if not in_header:
					header_done = true
			continue
		if in_header:
			var parts: PackedStringArray = line.split(":", true, 1)
			if parts.size() == 2:
				result.header[parts[0].strip_edges()] = parts[1].strip_edges()
			continue
		if line.is_empty():
			continue
		result.grid.append(line)

	if result.grid.is_empty():
		result.errors.append("%s : grille vide" % path)
	return result


## Construit le monde dans `parent`. Retourne le resultat analyse.
static func build(path: String, parent: Node2D, player: Node2D) -> Result:
	var result: Result = parse(path)
	if not result.errors.is_empty():
		return result

	_scan_cells(result)
	_merge_solids(result)
	_create_bodies(result, parent)
	_create_entities(result, parent, player)
	return result


## Premiere passe : on releve tout ce que la grille contient.
static func _scan_cells(result: Result) -> void:
	var spawn_found: bool = false
	var flag_found: bool = false
	for row: int in range(result.grid.size()):
		var line: String = result.grid[row]
		for column: int in range(line.length()):
			var cell: String = line[column]
			match cell:
				EMPTY, SOLID, ONE_WAY:
					continue
				SPAWN:
					result.spawn = _feet_position(column, row)
					spawn_found = true
				FLAG:
					result.flag = _feet_position(column, row)
					flag_found = true
				CHECKPOINT:
					result.checkpoints.append(_feet_position(column, row))
				SPIKE:
					result.spikes.append(_cell_rect(column, row))
				GIFT, AMBER, HIDDEN_AMBER:
					continue
				_:
					if not ENEMIES.has(cell):
						result.errors.append(
							"caractere inconnu '%s' en ligne %d colonne %d"
							% [cell, row, column]
						)
	if not spawn_found:
		result.errors.append("aucun depart 'S'")
	if not flag_found:
		result.errors.append("aucun drapeau 'F'")


## Fusionne les tuiles solides voisines en bandes horizontales : une grille
## de 100 x 14 ferait 1400 formes de collision, la fusion en laisse quelques
## dizaines. C'est le budget de 200 noeuds de B.11 qui l'impose.
static func _merge_solids(result: Result) -> void:
	for row: int in range(result.grid.size()):
		_merge_row(result, row, SOLID, result.solids)
		_merge_row(result, row, ONE_WAY, result.one_ways)


static func _merge_row(
	result: Result, row: int, symbol: String, into: Array[Rect2]
) -> void:
	var line: String = result.grid[row] + EMPTY
	var start: int = -1
	for column: int in range(line.length()):
		var matches: bool = line[column] == symbol
		if matches and start == -1:
			start = column
		elif not matches and start != -1:
			into.append(Rect2(
				float(start * TILE), float(row * TILE),
				float((column - start) * TILE), float(TILE)
			))
			start = -1


static func _create_bodies(result: Result, parent: Node2D) -> void:
	_add_body(parent, "Solids", result.solids, CollisionLayers.WORLD, false)
	# Plateformes traversables par le bas : on saute au travers, on retombe
	# dessus. Le bord superieur pointille de C.8 les distingue a l'oeil.
	_add_body(parent, "OneWays", result.one_ways, CollisionLayers.ONE_WAY, true)
	_add_hazards(parent, result.spikes)


static func _add_body(
	parent: Node2D, name: String, rects: Array[Rect2], layer: int, one_way: bool
) -> void:
	if rects.is_empty():
		return
	var body: StaticBody2D = StaticBody2D.new()
	body.name = name
	body.collision_layer = layer
	body.collision_mask = 0
	parent.add_child(body)
	for rect: Rect2 in rects:
		var shape: CollisionShape2D = CollisionShape2D.new()
		var box: RectangleShape2D = RectangleShape2D.new()
		box.size = rect.size
		shape.shape = box
		shape.position = rect.position + rect.size * 0.5
		shape.one_way_collision = one_way
		body.add_child(shape)


static func _add_hazards(parent: Node2D, rects: Array[Rect2]) -> void:
	if rects.is_empty():
		return
	var area: Area2D = Area2D.new()
	area.name = "Spikes"
	area.collision_layer = CollisionLayers.HAZARD
	area.collision_mask = CollisionLayers.PLAYER_HURTBOX
	parent.add_child(area)
	for rect: Rect2 in rects:
		var shape: CollisionShape2D = CollisionShape2D.new()
		var box: RectangleShape2D = RectangleShape2D.new()
		# Plus bas que la tuile : on ne se blesse pas en frolant le bord.
		box.size = Vector2(rect.size.x * 0.8, rect.size.y * 0.55)
		shape.shape = box
		shape.position = rect.position + Vector2(rect.size.x * 0.5, rect.size.y * 0.72)
		area.add_child(shape)


static func _create_entities(result: Result, parent: Node2D, player: Node2D) -> void:
	var gift_scene: PackedScene = load(GIFT_SCENE) as PackedScene
	var pickup_scene: PackedScene = load(PICKUP_SCENE) as PackedScene
	var enemy_scene: PackedScene = load(ENEMY_SCENE) as PackedScene

	for row: int in range(result.grid.size()):
		var line: String = result.grid[row]
		for column: int in range(line.length()):
			var cell: String = line[column]
			var center: Vector2 = _cell_center(column, row)
			match cell:
				GIFT:
					var box: GiftBox = gift_scene.instantiate() as GiftBox
					box.position = center
					parent.add_child(box)
					box.setup(player)
				AMBER, HIDDEN_AMBER:
					var amber: Pickup = pickup_scene.instantiate() as Pickup
					# Un ambre ne poursuit pas : il attend d'etre touche.
					amber.amber_value = 10 if cell == AMBER else 50
					amber.tint = Color(1.0, 0.72, 0.2) if cell == AMBER \
						else Color(1.0, 0.45, 0.1)
					amber.set_deferred(&"position", center)
					parent.add_child(amber)
					amber.rest_at(center, player)
				_:
					if not ENEMIES.has(cell):
						continue
					var enemy: Enemy = enemy_scene.instantiate() as Enemy
					enemy.data = Database.enemy(ENEMIES[cell]) as EnemyData
					enemy.position = _feet_position(column, row)
					parent.add_child(enemy)


static func _cell_rect(column: int, row: int) -> Rect2:
	return Rect2(float(column * TILE), float(row * TILE), float(TILE), float(TILE))


static func _cell_center(column: int, row: int) -> Vector2:
	return Vector2(float(column * TILE + TILE / 2), float(row * TILE + TILE / 2))


## Les entites posees au sol ont leur repere aux pieds.
static func _feet_position(column: int, row: int) -> Vector2:
	return Vector2(float(column * TILE + TILE / 2), float((row + 1) * TILE))
