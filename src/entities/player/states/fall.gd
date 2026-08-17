extends PlayerState
## Chute, qu'elle vienne d'un saut ou d'un simple pas dans le vide.

## Vitesse de chute au moment du contact, memorisee pour l'effet
## d'ecrasement a l'atterrissage.
var _impact_speed: float = 0.0


func physics_update(delta: float) -> StringName:
	player.apply_gravity(delta)
	player.apply_horizontal(delta, player.config.air_control)
	_impact_speed = player.velocity.y

	# Coyote time : sauter reste possible un court instant apres avoir
	# quitte le sol. `try_jump` verifie la fenetre et la referme.
	if player.try_jump():
		return &"jump"

	if player.is_on_floor():
		player.on_landed(_impact_speed)
		return &"run" if absf(player.input_axis) > 0.1 else &"idle"
	return &""


func get_animation() -> StringName:
	return &"fall"
