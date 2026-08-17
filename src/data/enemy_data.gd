class_name EnemyData
extends Resource
## Definition d'un ennemi (A.7).
##
## Une SEULE scene generique lit ces donnees. Ajouter un ennemi ne demande
## qu'un `.tres`, tant que son comportement existe deja — c'est la meme
## regle que pour les pouvoirs.

## Comportements disponibles (A.7). Chacun est un fichier de
## `src/entities/enemies/behaviors/`.
enum Behavior { PATROL, BITER, DIVER, CHARGER, JUMPER, STATIC }

@export var id: StringName = &""
@export var name_key: String = ""
@export var behavior: Behavior = Behavior.PATROL

@export_group("Combat")
@export var max_health: int = 1
@export var contact_damage: int = 1
## false pour STEGOPIK et les ennemis a piques : sauter dessus blesse (A.7).
@export var stompable: bool = true
## Recompense en ambres.
@export var amber_reward: int = 5

@export_group("Deplacement")
@export var move_speed: float = 90.0
## Amplitude du mouvement propre au comportement (portee de plongeon,
## hauteur de morsure, distance de charge...).
@export var range_pixels: float = 220.0
## Periode du cycle, pour les comportements rythmes.
@export var cycle_seconds: float = 2.0

@export_group("Apparence")
@export var color: Color = Color(0.6, 0.8, 0.4)
@export var size: Vector2 = Vector2(64.0, 64.0)
## Symbole daltonien (C.8). Tout ce qui est dangereux porte en plus un
## contour epais et un lisere rouge.
@export var shape_symbol: String = "▲"


func validate() -> PackedStringArray:
	var problems: PackedStringArray = PackedStringArray()
	if String(id).is_empty():
		problems.append("id vide")
	if max_health < 1:
		problems.append("%s : PV invalides" % id)
	if size.x <= 0.0 or size.y <= 0.0:
		problems.append("%s : taille invalide" % id)
	return problems
