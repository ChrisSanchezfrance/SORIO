extends PlayerState
## SORIO en course au sol.

## Vitesse en dessous de laquelle, sans direction tenue, on repasse a l'arret.
const IDLE_SPEED: float = 12.0


func physics_update(delta: float) -> StringName:
	player.apply_gravity(delta)
	player.apply_horizontal(delta)

	if player.try_jump():
		return &"jump"
	if not player.is_on_floor():
		return &"fall"
	# On ne repasse a l'arret qu'une fois vraiment stoppe : sinon SORIO
	# clignoterait entre les deux animations pendant la deceleration.
	if absf(player.input_axis) <= 0.1 and absf(player.velocity.x) < IDLE_SPEED:
		return &"idle"
	return &""


func get_animation() -> StringName:
	return &"run"
