extends TestCase
## Pouvoirs : donnees, tirage, apparence et usure (A.6).
##
## Le point qui compte le plus ici n'est pas qu'un pouvoir "marche", mais
## qu'il SE VOIE sur SORIO. Un enfant de 8 ans ne lit pas un HUD ; il regarde
## son bonhomme. Si la tenue ne change pas, le pouvoir n'existe pas pour lui.

var _sprite: Sprite2D = null
var _system: PowerSystem = null
var _holder: Node2D = null


func before_each() -> void:
	_holder = Node2D.new()
	tree.root.add_child(_holder)
	_sprite = Sprite2D.new()
	_holder.add_child(_sprite)
	_system = PowerSystem.new()
	_holder.add_child(_system)
	_system.setup(_sprite)
	await tree.process_frame


func after_each() -> void:
	if is_instance_valid(_holder):
		_holder.queue_free()
	_holder = null
	_system = null
	_sprite = null


func _power(id: StringName) -> PowerData:
	return Database.power(id) as PowerData


func _tunic() -> Vector3:
	return _sprite.material.get_shader_parameter(&"tunic_target")


# --- Les 36 pouvoirs existent et sont coherents -----------------------------

func test_all_thirty_six_powers_exist() -> void:
	assert_eq(Database.count("powers"), 36, "les 36 pouvoirs de A.6")


func test_every_power_is_valid() -> void:
	for resource: Resource in Database.all("powers"):
		var power: PowerData = resource as PowerData
		var problems: PackedStringArray = power.validate()
		assert_eq(problems.size(), 0, "  ".join(problems))


func test_every_power_has_either_duration_or_charges() -> void:
	# Un pouvoir sans cout ne s'epuiserait jamais et casserait l'equilibre.
	for resource: Resource in Database.all("powers"):
		var power: PowerData = resource as PowerData
		assert_true(power.duration > 0.0 or power.charges > 0,
			"%s n'a ni duree ni charges" % power.id)


func test_powers_have_distinct_colors() -> void:
	# Deux pouvoirs de meme couleur seraient impossibles a distinguer sur
	# SORIO, ce qui viderait le systeme de son interet.
	var seen: Array[String] = []
	for resource: Resource in Database.all("powers"):
		var power: PowerData = resource as PowerData
		var key: String = "%.2f_%.2f_%.2f" % [power.color.r, power.color.g, power.color.b]
		assert_false(seen.has(key), "couleur en double : %s" % power.id)
		seen.append(key)


func test_rarity_weights_sum_to_one_hundred() -> void:
	var total: int = 0
	for weight: int in PowerData.RARITY_WEIGHTS.values():
		total += weight
	assert_eq(total, 100, "table de rarete de A.6")


# --- Apparence : le pouvoir se voit sur SORIO -------------------------------

func test_granting_a_power_changes_the_outfit() -> void:
	var before: Vector3 = _tunic()
	_system.grant(_power(&"flamme"))
	var after: Vector3 = _tunic()
	assert_ne(after, before, "la tunique doit prendre la couleur du pouvoir")
	var expected: Color = _power(&"flamme").color
	assert_almost_eq(after.x, expected.r, 0.01)
	assert_almost_eq(after.y, expected.g, 0.01)


func test_losing_a_power_restores_the_original_outfit() -> void:
	_system.grant(_power(&"glace"))
	_system.clear()
	var restored: Vector3 = _tunic()
	assert_almost_eq(restored.x, PowerSystem.TUNIC_BASE.r, 0.01)
	assert_almost_eq(restored.y, PowerSystem.TUNIC_BASE.g, 0.01)


func test_trousers_follow_the_power_too() -> void:
	# La tenue entiere change, pas seulement le haut.
	_system.grant(_power(&"ombre"))
	var trousers: Vector3 = _sprite.material.get_shader_parameter(&"trousers_target")
	var expected: Color = _power(&"ombre").secondary_color()
	assert_almost_eq(trousers.x, expected.r, 0.01)


func test_secondary_color_is_darker_than_the_main_one() -> void:
	for resource: Resource in Database.all("powers"):
		var power: PowerData = resource as PowerData
		assert_lt(power.secondary_color().get_luminance(),
			power.color.get_luminance() + 0.001,
			"%s : le bas doit etre plus sombre que le haut" % power.id)


func test_the_scarf_is_never_touched_by_a_power() -> void:
	# L'echarpe porte les PV (A.3). Si un pouvoir la teintait, l'information
	# vitale du jeu deviendrait illisible.
	_system.grant(_power(&"arc_en_ciel"))
	var tunic_src: Vector3 = _sprite.material.get_shader_parameter(&"tunic_source")
	var trousers_src: Vector3 = _sprite.material.get_shader_parameter(&"trousers_source")
	for scarf: Color in Player.SCARF_COLORS:
		var value: Vector3 = Vector3(scarf.r, scarf.g, scarf.b)
		assert_gt(value.distance_to(tunic_src), 0.06,
			"une couleur d'echarpe serait confondue avec la tunique")
		assert_gt(value.distance_to(trousers_src), 0.06,
			"une couleur d'echarpe serait confondue avec le pantalon")


# --- Usure ------------------------------------------------------------------

func test_a_timed_power_expires_on_its_own() -> void:
	var power: PowerData = _power(&"flamme")
	_system.grant(power)
	assert_true(_system.has_power())
	# On avance le compteur a la main plutot que d'attendre 10 secondes.
	_system.remaining_time = 0.02
	await tree.process_frame
	await tree.process_frame
	assert_false(_system.has_power(), "le pouvoir doit s'eteindre seul")


func test_charges_run_out() -> void:
	var power: PowerData = _power(&"eclair")
	_system.grant(power)
	assert_eq(_system.remaining_charges, power.charges)
	for i: int in range(power.charges):
		assert_true(_system.use_charge(), "chaque charge doit repondre")
	assert_false(_system.has_power(), "a zero charge, le pouvoir disparait")


func test_a_timed_power_ignores_charge_use() -> void:
	_system.grant(_power(&"flamme"))
	assert_false(_system.use_charge(),
		"un pouvoir a duree ne se consomme pas a l'usage")
	assert_true(_system.has_power())


func test_remaining_ratio_falls_from_one_to_zero() -> void:
	var power: PowerData = _power(&"eclair")
	_system.grant(power)
	assert_almost_eq(_system.remaining_ratio(), 1.0, 0.001)
	_system.use_charge()
	assert_lt(_system.remaining_ratio(), 1.0)


# --- Le pouvoir sert de bouclier (A.6) --------------------------------------

func test_power_absorbs_damage_instead_of_health() -> void:
	_system.grant(_power(&"pierre"))
	assert_true(_system.absorb_damage(), "le pouvoir doit encaisser")
	assert_false(_system.has_power(), "et disparaitre en le faisant")


func test_without_power_nothing_is_absorbed() -> void:
	assert_false(_system.absorb_damage(),
		"sans pouvoir, le degat doit passer aux PV")


# --- Tirage au sort ---------------------------------------------------------

func test_rolling_always_returns_a_power() -> void:
	# Un cadeau vide serait incomprehensible : le tirage redescend d'un cran
	# de rarete plutot que de ne rien donner.
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	for seed_value: int in range(60):
		rng.seed = seed_value
		assert_not_null(PowerSystem.roll_random_power(rng),
			"tirage vide avec la graine %d" % seed_value)


func test_common_powers_dominate_the_draw() -> void:
	# 60 % de communs en A.6. On verifie l'ordre de grandeur, pas la valeur
	# exacte : un tirage reste un tirage.
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = 12345
	var commons: int = 0
	const DRAWS: int = 400
	for i: int in range(DRAWS):
		var power: PowerData = PowerSystem.roll_random_power(rng)
		if power != null and power.rarity == PowerData.Rarity.COMMON:
			commons += 1
	var share: float = float(commons) / float(DRAWS)
	assert_between(share, 0.45, 0.85, "part de communs obtenue : %.0f %%" % (share * 100.0))


func test_every_rarity_has_at_least_one_power() -> void:
	for rarity: PowerData.Rarity in [
		PowerData.Rarity.COMMON, PowerData.Rarity.RARE,
		PowerData.Rarity.EPIC, PowerData.Rarity.LEGENDARY,
	]:
		assert_gt(float(PowerSystem.powers_of_rarity(rarity).size()), 0.0,
			"aucun pouvoir pour la rarete %d" % rarity)
