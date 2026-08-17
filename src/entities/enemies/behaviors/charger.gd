extends EnemyBehavior
## Charge en ligne droite puis recule (TRICRASH — A.7).
##
## La pause avant chaque charge est le telegraphe : sans elle, l'ennemi
## devient injuste. Meme principe que les boss (A.8).

const TELEGRAPH_SECONDS: float = 0.7

var _time: float = 0.0


func update(delta: float) -> void:
	enemy.apply_gravity(delta)
	_time += delta
	var cycle: float = maxf(1.0, data().cycle_seconds)
	var phase: float = fmod(_time, cycle)

	if phase < TELEGRAPH_SECONDS:
		# Il gratte le sol : on voit que ca va partir.
		enemy.velocity.x = 0.0
		return
	if enemy.is_on_floor() and (enemy.is_on_wall() or enemy.is_at_ledge()):
		enemy.turn_around()
		_time = 0.0
		return
	enemy.velocity.x = float(enemy.facing) * data().move_speed
