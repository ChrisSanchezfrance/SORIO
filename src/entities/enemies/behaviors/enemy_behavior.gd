class_name EnemyBehavior
extends Node
## Comportement d'un ennemi (A.7).
##
## Un comportement ne connait que son ennemi et ses donnees. Il n'appelle
## jamais le joueur ni le niveau : c'est ce qui permet de reutiliser le meme
## comportement pour plusieurs ennemis, avec des chiffres differents.

var enemy: Enemy = null


func enter() -> void:
	pass


func update(_delta: float) -> void:
	pass


func data() -> EnemyData:
	return enemy.data


## Fabrique : associe un comportement de `EnemyData` a sa classe.
static func create(kind: EnemyData.Behavior) -> EnemyBehavior:
	match kind:
		EnemyData.Behavior.PATROL:
			return preload("res://src/entities/enemies/behaviors/patrol.gd").new()
		EnemyData.Behavior.BITER:
			return preload("res://src/entities/enemies/behaviors/biter.gd").new()
		EnemyData.Behavior.DIVER:
			return preload("res://src/entities/enemies/behaviors/diver.gd").new()
		EnemyData.Behavior.CHARGER:
			return preload("res://src/entities/enemies/behaviors/charger.gd").new()
		EnemyData.Behavior.JUMPER:
			return preload("res://src/entities/enemies/behaviors/jumper.gd").new()
		_:
			return preload("res://src/entities/enemies/behaviors/static_behavior.gd").new()
