extends EnemyBehavior
## Plante carnivore qui sort du sol par cycles et mord (GUEULE-PIEGE — A.7).
##
## Le rythme est fixe et lisible : c'est un obstacle de TIMING, pas un piege.
## Un enfant doit pouvoir l'observer deux secondes et comprendre quand passer.

## Part du cycle passee cachee. Plus de la moitie : on laisse le temps de
## passer sans courir.
const HIDDEN_RATIO: float = 0.55

var _time: float = 0.0
var _base_y: float = 0.0


func enter() -> void:
	_base_y = enemy.origin.y
	enemy.global_position.y = _base_y + data().range_pixels


func update(delta: float) -> void:
	_time += delta
	var cycle: float = maxf(0.2, data().cycle_seconds)
	var phase: float = fmod(_time, cycle) / cycle

	var extension: float = 0.0
	if phase > HIDDEN_RATIO:
		# Sortie puis rentree, en douceur : la morsure se voit venir.
		var t: float = (phase - HIDDEN_RATIO) / (1.0 - HIDDEN_RATIO)
		extension = sin(t * PI)
	enemy.global_position.y = _base_y + data().range_pixels * (1.0 - extension)
	enemy.velocity = Vector2.ZERO
