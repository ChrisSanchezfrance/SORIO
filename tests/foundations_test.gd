extends TestCase
## Tests de la passe 0 : ce qui doit etre vrai avant d'ecrire une ligne de
## gameplay. Si un de ces cas casse, tout le reste devient suspect.


# --- Couches de physique ----------------------------------------------------

func test_collision_layers_are_distinct_bits() -> void:
	# Deux couches qui partagent un bit provoqueraient des collisions
	# fantomes, extremement penibles a diagnostiquer plus tard.
	var seen: Array[int] = []
	for bit: int in CollisionLayers.NAMES:
		assert_false(seen.has(bit), "bit en double : %d" % bit)
		seen.append(bit)
	assert_eq(seen.size(), 12, "les 12 couches de B.4 doivent exister")


func test_collision_layers_match_project_settings() -> void:
	for bit: int in CollisionLayers.NAMES:
		var index: int = int(round(log(float(bit)) / log(2.0))) + 1
		var declared: String = String(ProjectSettings.get_setting(
			"layer_names/2d_physics/layer_%d" % index, ""
		))
		assert_eq(
			declared, String(CollisionLayers.NAMES[bit]),
			"couche %d desynchronisee entre project.godot et CollisionLayers" % index
		)


func test_solid_all_contains_expected_layers() -> void:
	assert_true(CollisionLayers.SOLID_ALL & CollisionLayers.WORLD > 0)
	assert_true(CollisionLayers.SOLID_ALL & CollisionLayers.ONE_WAY > 0)
	assert_true(CollisionLayers.SOLID_ALL & CollisionLayers.BREAKABLE > 0)
	assert_eq(CollisionLayers.SOLID_ALL & CollisionLayers.ENEMY, 0,
		"un ennemi n'est pas du decor solide")


func test_describe_lists_layer_names() -> void:
	var text: String = CollisionLayers.describe(
		CollisionLayers.WORLD | CollisionLayers.ENEMY
	)
	assert_true(text.contains("world"))
	assert_true(text.contains("enemy"))


# --- Options ----------------------------------------------------------------

func test_settings_clamp_out_of_range_values() -> void:
	# Un fichier settings.cfg edite a la main ne doit jamais casser le jeu.
	var before: int = Settings.get_int_option(&"audio", &"music")
	Settings.set_option(&"audio", &"music", 999)
	assert_eq(Settings.get_int_option(&"audio", &"music"), 100,
		"un volume hors bornes doit etre ramene a 100")
	Settings.set_option(&"audio", &"music", -50)
	assert_eq(Settings.get_int_option(&"audio", &"music"), 0)
	Settings.set_option(&"audio", &"music", before)


func test_settings_reject_unknown_enum_value() -> void:
	var before: String = Settings.get_string(&"accessibility", &"colorblind_mode")
	Settings.set_option(&"accessibility", &"colorblind_mode", "licorne")
	assert_eq(Settings.get_string(&"accessibility", &"colorblind_mode"), "none",
		"une valeur inconnue retombe sur la premiere valeur autorisee")
	Settings.set_option(&"accessibility", &"colorblind_mode", before)


func test_settings_button_scale_stays_in_c2_range() -> void:
	# C.2 : quatre tailles, de 0,85 a 1,5. Rien en dehors.
	Settings.set_option(&"controls", &"button_scale", 5.0)
	assert_almost_eq(Settings.get_float_option(&"controls", &"button_scale"), 1.5, 0.001)
	Settings.set_option(&"controls", &"button_scale", 0.1)
	assert_almost_eq(Settings.get_float_option(&"controls", &"button_scale"), 0.85, 0.001)
	Settings.set_option(&"controls", &"button_scale", 1.0)


# --- Sauvegarde -------------------------------------------------------------

func test_stars_never_decrease() -> void:
	# Rejouer un niveau moins bien ne doit jamais retirer une etoile deja
	# gagnee : un enfant ne perd pas sa progression en s'amusant.
	var data: SaveData = SaveData.new()
	data.set_star_count(1, 3, 3)
	data.set_star_count(1, 3, 1)
	assert_eq(data.star_count(1, 3), 3)


func test_stars_are_clamped_to_three() -> void:
	var data: SaveData = SaveData.new()
	data.set_star_count(2, 1, 99)
	assert_eq(data.star_count(2, 1), 3)


func test_stars_in_world_counts_only_that_world() -> void:
	var data: SaveData = SaveData.new()
	data.set_star_count(1, 1, 3)
	data.set_star_count(1, 2, 2)
	data.set_star_count(2, 1, 3)
	assert_eq(data.stars_in_world(1), 5)
	assert_eq(data.stars_in_world(2), 3)


func test_fresh_save_is_detected() -> void:
	var data: SaveData = SaveData.new()
	assert_true(data.is_fresh())
	assert_eq(data.completion_percent(), 0)


func test_save_round_trip_preserves_progress() -> void:
	# Ecriture atomique puis relecture : la garantie centrale de B.8.
	const SLOT: int = 3
	var data: SaveData = SaveData.new()
	data.amber = 1234
	data.world_reached = 4
	data.set_star_count(4, 2, 3)
	data.powers_discovered.append(&"eclair")

	assert_true(SaveManager.save_slot(SLOT, data), "l'ecriture doit reussir")
	var reloaded: SaveData = SaveManager.load_slot(SLOT)
	assert_eq(reloaded.amber, 1234)
	assert_eq(reloaded.world_reached, 4)
	assert_eq(reloaded.star_count(4, 2), 3)
	assert_has(reloaded.powers_discovered, &"eclair")
	assert_eq(reloaded.version, SaveData.CURRENT_VERSION)

	SaveManager.delete_slot(SLOT)
	assert_false(SaveManager.has_save(SLOT))


func test_save_leaves_no_temp_file_behind() -> void:
	# Le fichier .tmp ne doit jamais survivre a une ecriture reussie, sinon
	# on ne saurait plus laquelle des deux versions fait foi.
	const SLOT: int = 2
	var data: SaveData = SaveData.new()
	data.amber = 7
	SaveManager.save_slot(SLOT, data)
	assert_false(
		FileAccess.file_exists(SaveManager.slot_temp_path(SLOT)),
		"le fichier temporaire doit avoir ete renomme"
	)
	SaveManager.delete_slot(SLOT)


# --- Haptique ---------------------------------------------------------------

func test_amber_pickup_has_no_vibration() -> void:
	# C.3 : volontairement silencieux. Trop frequent pour vibrer.
	assert_eq(int(Haptics.PATTERNS[&"amber"]), 0)


func test_haptic_durations_match_spec() -> void:
	assert_eq(int(Haptics.PATTERNS[&"ui_button"]), 10)
	assert_eq(int(Haptics.PATTERNS[&"jump"]), 15)
	assert_eq(int(Haptics.PATTERNS[&"damage"]), 80)
	assert_eq(int(Haptics.PATTERNS[&"death"]), 200)
	assert_eq(int(Haptics.PATTERNS[&"crystal"]), 400)


func test_boss_defeated_is_a_triple_pulse() -> void:
	var sequence: Array = Haptics.SEQUENCES[&"boss_defeated"]
	assert_eq(sequence.size(), 3, "3 impulsions (C.3)")
	for step: Array in sequence:
		assert_eq(int(step[0]), 80)


# --- Boutons tactiles -------------------------------------------------------

func test_touch_button_constants_match_c2() -> void:
	assert_eq(TouchButton.MIN_VISUAL_SIZE, 64.0, "taille minimale de C.2")
	assert_almost_eq(TouchButton.TOUCH_MARGIN_RATIO, 0.20, 0.0001)
	assert_eq(TouchButton.MIN_SPACING, 24.0)
	assert_eq(TouchButton.EDGE_MARGIN, 32.0)
	assert_almost_eq(TouchButton.IDLE_OPACITY, 0.55, 0.0001)
	assert_almost_eq(TouchButton.PRESSED_OPACITY, 1.0, 0.0001)


func test_touch_button_reacts_under_100ms() -> void:
	# Critere 3 de C.2, verifie sur la constante plutot qu'a l'oeil.
	assert_lt(TouchButton.REACT_SECONDS, 0.1)


func test_touch_button_scale_presets_are_the_four_of_c2() -> void:
	assert_eq(TouchButton.SCALE_PRESETS.size(), 4)
	assert_almost_eq(float(TouchButton.SCALE_PRESETS[&"small"]), 0.85, 0.0001)
	assert_almost_eq(float(TouchButton.SCALE_PRESETS[&"huge"]), 1.5, 0.0001)
