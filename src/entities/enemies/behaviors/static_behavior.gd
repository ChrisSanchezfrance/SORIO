extends EnemyBehavior
## Ennemi immobile : obstacle pur, qu'on contourne ou qu'on frappe.


func update(delta: float) -> void:
	enemy.apply_gravity(delta)
	enemy.velocity.x = 0.0
