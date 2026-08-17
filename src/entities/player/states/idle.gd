extends PlayerState
## SORIO immobile au sol.

## En dessous de cette vitesse residuelle, on considere l'arret complet.
const STOP_SPEED: float = 12.0


func enter(_previous: StringName) -> void:
	player.is_jump_cuttable = false


func physics_update(delta: float) -> StringName:
	player.apply_gravity(delta)
	player.apply_horizontal(delta)

	# Le saut se teste AVANT la chute : un appui memorise juste avant
	# l'atterrissage doit partir des la premiere frame au sol (jump buffer).
	if player.try_jump():
		return &"jump"
	if not player.is_on_floor():
		return &"fall"
	if absf(player.input_axis) > 0.1:
		return &"run"
	return &""


func get_animation() -> StringName:
	return &"idle"
