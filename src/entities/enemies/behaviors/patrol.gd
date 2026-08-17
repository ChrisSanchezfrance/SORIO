extends EnemyBehavior
## Marche et fait demi-tour au bord des plateformes (RAPTOZ, COMPSO — A.7).
##
## Le demi-tour au bord est ce qui evite l'ennemi le plus frustrant du genre :
## celui qui tombe tout seul du decor et qu'on ne peut plus vaincre.


func update(delta: float) -> void:
	enemy.apply_gravity(delta)
	if enemy.is_on_floor():
		# Un mur devant ou un vide devant : on repart dans l'autre sens.
		if enemy.is_on_wall() or enemy.is_at_ledge():
			enemy.turn_around()
		enemy.velocity.x = float(enemy.facing) * data().move_speed
