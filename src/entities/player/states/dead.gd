extends PlayerState
## Mort de SORIO.
##
## Ne decide pas de la suite : c'est le niveau qui ecoute
## `EventBus.player_died` et choisit le point de controle (A.11 : jamais un
## retour au debut du monde).

const DEATH_LIFT: float = -700.0


func enter(_previous: StringName) -> void:
	player.velocity = Vector2(0.0, DEATH_LIFT)
	player.is_jump_cuttable = false
	# Le corps ne collisionne plus : SORIO retombe hors de l'ecran.
	player.collision_mask = 0
	Haptics.pulse(&"death")


func physics_update(delta: float) -> StringName:
	player.apply_gravity(delta)
	return &""


func get_animation() -> StringName:
	return &"dead"


func can_take_damage() -> bool:
	return false
