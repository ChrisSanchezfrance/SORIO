class_name PlayerState
extends Node
## Etat de base de SORIO.
##
## Un etat ne touche jamais directement a `velocity` sans passer par les
## aides du joueur (`apply_gravity`, `apply_horizontal`) : c'est ce qui
## garantit que la physique de B.4 reste appliquee de la meme facon partout,
## quel que soit l'etat.
##
## `physics_update` retourne le nom de l'etat suivant, ou `&""` pour rester.
## Aucun etat n'appelle `change_state` lui-meme : les transitions remontent a
## la machine, donc elles sont toutes visibles au meme endroit.

## Injecte par la machine a etats a l'initialisation. Jamais via get_parent().
var player: Player = null


## Appele une fois a l'entree. `previous` sert aux transitions contextuelles
## (par exemple atterrir depuis Fall declenche l'ecrasement visuel).
func enter(previous: StringName) -> void:
	pass


func exit() -> void:
	pass


func physics_update(_delta: float) -> StringName:
	return &""


## Nom de l'animation a jouer dans cet etat.
func get_animation() -> StringName:
	return &"idle"


## Un etat peut refuser les degats (invincibilite d'un dash, mort deja en cours).
func can_take_damage() -> bool:
	return true
