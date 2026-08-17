extends PlayerState
## Recul apres un degat.
##
## Court volontairement : reprendre la main vite est plus important que
## montrer une longue animation. Un enfant qui perd le controle 1 s se sent
## puni deux fois.

const KNOCKBACK_SECONDS: float = 0.22
const KNOCKBACK_SPEED: float = 260.0
const KNOCKBACK_LIFT: float = -420.0

var _elapsed: float = 0.0


func enter(_previous: StringName) -> void:
	_elapsed = 0.0
	# Recul a l'oppose du regard, avec un petit soulevement lisible.
	player.velocity.x = -float(player.facing) * KNOCKBACK_SPEED
	player.velocity.y = KNOCKBACK_LIFT
	player.is_jump_cuttable = false
	player.squash(Player.SQUASH_SCALE)


func physics_update(delta: float) -> StringName:
	_elapsed += delta
	player.apply_gravity(delta)
	if _elapsed < KNOCKBACK_SECONDS:
		return &""
	if player.is_on_floor():
		return &"idle"
	return &"fall"


func get_animation() -> StringName:
	return &"hurt"


## Pas de degats en chaine pendant le recul.
func can_take_damage() -> bool:
	return false
