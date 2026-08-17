extends EnemyBehavior
## Bondit en arcs paraboliques (BOURGEON-BONDISSANT — A.7).
##
## Se bat en l'air : sa faiblesse est l'ecrasement pendant qu'il saute.

const JUMP_VELOCITY: float = -720.0

var _cooldown: float = 0.0


func update(delta: float) -> void:
	enemy.apply_gravity(delta)
	if not enemy.is_on_floor():
		return
	_cooldown -= delta
	enemy.velocity.x = 0.0
	if _cooldown > 0.0:
		return
	_cooldown = maxf(0.4, data().cycle_seconds)
	if enemy.is_on_wall() or enemy.is_at_ledge():
		enemy.turn_around()
	enemy.velocity = Vector2(float(enemy.facing) * data().move_speed, JUMP_VELOCITY)
