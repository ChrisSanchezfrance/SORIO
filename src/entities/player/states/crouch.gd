extends PlayerState
## SORIO accroupi (bas du stick).
##
## Volontairement simple : on ne se deplace pas accroupi. Un accroupissement
## qui glisse lentement ajoute une vitesse de plus a comprendre, pour un
## gain nul a 8 ans. On s'accroupit pour passer sous quelque chose ou pour
## esquiver ; des qu'on relache, on repart.

## Vitesse residuelle en dessous de laquelle on considere l'arret.
const STOP_SPEED: float = 8.0


func enter(_previous: StringName) -> void:
	player.set_crouched(true)
	player.is_jump_cuttable = false


func exit() -> void:
	player.set_crouched(false)


func physics_update(delta: float) -> StringName:
	player.apply_gravity(delta)
	# On freine jusqu'a l'arret, sans repondre a la direction tenue.
	player.velocity.x = move_toward(
		player.velocity.x, 0.0, player.config.run_friction * delta
	)

	# Le bouton A reste prioritaire : on peut sauter depuis l'accroupi.
	if player.try_jump():
		return &"jump"
	if not player.is_on_floor():
		return &"fall"
	if not player.input_down:
		return &"run" if absf(player.input_axis) > 0.1 else &"idle"
	return &""


func get_animation() -> StringName:
	return &"crouch"
