extends PlayerState
## Phase montante du saut.
##
## L'etat ne declenche pas l'impulsion : c'est `Player.try_jump()` qui l'a
## deja donnee. Ici on gere la montee et la coupure a hauteur variable.


func physics_update(delta: float) -> StringName:
	# Relacher le bouton pendant la montee ecourte le saut (B.4).
	if not player.jump_held:
		player.cut_jump()

	player.apply_gravity(delta)
	player.apply_horizontal(delta, player.config.air_control)

	if player.velocity.y >= 0.0:
		return &"fall"
	# Un plafond touche en pleine montee : inutile de continuer a monter.
	if player.is_on_ceiling():
		player.velocity.y = 0.0
		return &"fall"
	return &""


func get_animation() -> StringName:
	return &"jump"
