extends CanvasLayer
## Panneau de debug (F1), disponible en developpement uniquement.
##
## Il sert a une seule chose : regler la physique de B.4 EN JOUANT, sans
## recompiler ni relancer. Le saut ne se regle pas sur le papier, il se regle
## au doigt en modifiant une valeur et en ressautant dans la seconde.
##
## Les curseurs ecrivent directement dans la `PlayerConfig` du joueur. Le
## bouton "Sauver" ecrit le `.tres`, ce qui rend le reglage permanent.

## Valeurs reglables en direct : cle -> [minimum, maximum, pas].
const TUNABLES: Dictionary = {
	&"gravity": [1000.0, 8000.0, 50.0],
	&"run_speed": [100.0, 900.0, 10.0],
	&"run_acceleration": [500.0, 8000.0, 50.0],
	&"run_friction": [200.0, 6000.0, 50.0],
	&"jump_velocity": [-2200.0, -400.0, 10.0],
	&"jump_cut_multiplier": [0.0, 1.0, 0.05],
	&"air_control": [0.1, 1.0, 0.05],
	&"max_fall_speed": [400.0, 3000.0, 50.0],
	&"coyote_time": [0.0, 0.4, 0.01],
	&"jump_buffer": [0.0, 0.4, 0.01],
}

const PANEL_WIDTH: float = 420.0
const ROW_HEIGHT: float = 26.0

var player: Player = null

var _root: PanelContainer = null
var _readout: Label = null
var _sliders: Dictionary = {}


func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build()
	visible = false


## Injection depuis le niveau : le panneau ne cherche jamais le joueur.
func attach(target: Player) -> void:
	player = target
	_refresh_sliders()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"debug_panel"):
		visible = not visible
		get_viewport().set_input_as_handled()


func _process(_delta: float) -> void:
	if visible and player != null:
		_update_readout()


func _build() -> void:
	_root = PanelContainer.new()
	_root.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_root.position = Vector2(16, 16)
	_root.custom_minimum_size = Vector2(PANEL_WIDTH, 0)
	add_child(_root)

	var column: VBoxContainer = VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	_root.add_child(column)

	var title: Label = Label.new()
	title.text = "F1 - physique (B.4)"
	title.add_theme_font_size_override("font_size", 18)
	column.add_child(title)

	_readout = Label.new()
	_readout.add_theme_font_size_override("font_size", 14)
	column.add_child(_readout)
	column.add_child(HSeparator.new())

	for key: StringName in TUNABLES:
		column.add_child(_build_row(key))

	column.add_child(HSeparator.new())
	var save_button: Button = Button.new()
	save_button.text = "Sauver dans player_config.tres"
	save_button.pressed.connect(_save_config)
	column.add_child(save_button)


func _build_row(key: StringName) -> Control:
	var row: HBoxContainer = HBoxContainer.new()
	row.custom_minimum_size = Vector2(0, ROW_HEIGHT)

	var label: Label = Label.new()
	label.text = String(key)
	label.custom_minimum_size = Vector2(170, 0)
	label.add_theme_font_size_override("font_size", 13)
	row.add_child(label)

	var bounds: Array = TUNABLES[key]
	var slider: HSlider = HSlider.new()
	slider.min_value = float(bounds[0])
	slider.max_value = float(bounds[1])
	slider.step = float(bounds[2])
	slider.custom_minimum_size = Vector2(160, 0)
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.value_changed.connect(_on_slider_changed.bind(key))
	row.add_child(slider)

	var value: Label = Label.new()
	value.custom_minimum_size = Vector2(70, 0)
	value.add_theme_font_size_override("font_size", 13)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(value)

	_sliders[key] = {"slider": slider, "value": value}
	return row


func _refresh_sliders() -> void:
	if player == null or player.config == null:
		return
	for key: StringName in _sliders:
		var entry: Dictionary = _sliders[key]
		var current: float = float(player.config.get(key))
		(entry["slider"] as HSlider).set_value_no_signal(current)
		(entry["value"] as Label).text = "%.2f" % current


func _on_slider_changed(new_value: float, key: StringName) -> void:
	if player == null or player.config == null:
		return
	player.config.set(key, new_value)
	(_sliders[key]["value"] as Label).text = "%.2f" % new_value


## Affichage en direct de ce qui compte vraiment pour juger le saut : l'etat,
## la vitesse, et surtout les deux fenetres de confort de B.4.
func _update_readout() -> void:
	var config: PlayerConfig = player.config
	_readout.text = (
		"etat %s   sol %s\n"
		% [player.state_machine.current_name, "oui" if player.is_on_floor() else "non"]
		+ "v = (%.0f, %.0f)\n" % [player.velocity.x, player.velocity.y]
		+ "coyote %.3f s   buffer %.3f s\n"
		% [player.coyote_timer, player.jump_buffer_timer]
		+ "saut : %.0f px de haut (%.1f tuiles), %.0f px de portee (%.1f tuiles)"
		% [
			config.max_jump_height(), config.max_jump_height_tiles(),
			config.max_jump_distance(), config.max_jump_distance_tiles(),
		]
	)


func _save_config() -> void:
	if player == null or player.config == null:
		return
	var err: int = ResourceSaver.save(player.config, Player.DEFAULT_CONFIG_PATH)
	if err != OK:
		push_error("[Debug] sauvegarde de la config impossible (code %d)" % err)
		return
	print("[Debug] player_config.tres sauve")
