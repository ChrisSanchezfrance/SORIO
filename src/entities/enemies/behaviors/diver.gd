extends EnemyBehavior
## Vole en cercle et plonge (PTERODARD — A.7).
##
## Le vol reste au-dessus de sa position de depart : un volant qui derive
## indefiniment sort de l'ecran et devient impossible a battre.

var _time: float = 0.0


func update(delta: float) -> void:
	_time += delta
	var cycle: float = maxf(0.5, data().cycle_seconds)
	var phase: float = TAU * _time / cycle
	# Ellipse : large horizontalement, courte verticalement. Le piquer se
	# lit comme une descente franche au bas de la boucle.
	enemy.global_position = enemy.origin + Vector2(
		cos(phase) * data().range_pixels * 0.5,
		sin(phase) * data().range_pixels * 0.28
	)
	enemy.velocity = Vector2.ZERO
	var direction: int = -1 if sin(phase) > 0.0 else 1
	if direction != enemy.facing:
		enemy.turn_around()
