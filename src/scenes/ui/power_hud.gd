extends CanvasLayer
## Affichage du pouvoir actif (A.6).
##
## Volontairement discret : SORIO porte deja la couleur de son pouvoir sur
## lui, donc ce HUD ne fait que confirmer. C'est le personnage qui informe,
## pas l'interface — un enfant regarde son bonhomme, pas le coin de l'ecran.
##
## Jauge circulaire autour de l'icone, comme demande en A.6 : elle descend
## avec le temps pour les pouvoirs a duree, avec les charges pour les autres.

const MARGIN: float = 24.0
const RADIUS: float = 40.0
const RING_WIDTH: float = 7.0
## Au-dela, la jauge devient rouge : le pouvoir va s'eteindre.
const WARNING_RATIO: float = 0.25

## Systeme observe. Injecte par le niveau (D.2.4).
var power_system: PowerSystem = null

var _root: Control = null
var _gauge: Control = null
var _label: Label = null
var _charges: Label = null


func _ready() -> void:
	layer = 5
	_build()
	_refresh(null)


func setup(system: PowerSystem) -> void:
	assert(system != null, "PowerHud.setup sans systeme")
	power_system = system
	power_system.power_changed.connect(_refresh)
	_refresh(power_system.active)


func _build() -> void:
	_root = Control.new()
	# Plein cadre : les positions ci-dessous sont calculees en coordonnees
	# ecran absolues. Avec un ancrage en haut-droite, le conteneur commence
	# a `screen.x` et tout le HUD partait hors de l'ecran.
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	_gauge = Control.new()
	_gauge.custom_minimum_size = Vector2(RADIUS * 2.0, RADIUS * 2.0)
	_gauge.size = _gauge.custom_minimum_size
	_gauge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_gauge.draw.connect(_draw_gauge)
	_root.add_child(_gauge)
	_gauge.visible = false

	_charges = Label.new()
	_charges.add_theme_font_size_override("font_size", 22)
	_charges.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_charges.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_charges.size = _gauge.size
	_charges.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_gauge.add_child(_charges)

	_label = Label.new()
	_label.add_theme_font_size_override("font_size", 18)
	_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	_label.add_theme_constant_override("outline_size", 5)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_label)
	_label.visible = false
	_layout()


func _process(_delta: float) -> void:
	if power_system == null or not power_system.has_power():
		return
	_gauge.queue_redraw()
	_update_charges()


func _refresh(power: PowerData) -> void:
	var has_power: bool = power != null
	_gauge.visible = has_power
	_label.visible = has_power
	set_process(has_power)
	if not has_power:
		return
	_label.text = tr(power.name_key)
	_label.add_theme_color_override("font_color", power.color)
	_update_charges()
	_layout()
	_gauge.queue_redraw()


func _update_charges() -> void:
	if power_system == null or power_system.active == null:
		return
	var power: PowerData = power_system.active
	# Les charges se comptent, la duree ne s'affiche pas en chiffres : un
	# compte a rebours en secondes ne veut rien dire a 8 ans, l'anneau qui
	# se vide oui.
	_charges.text = "" if power.is_timed() else str(power_system.remaining_charges)
	_charges.add_theme_color_override("font_color", Color.WHITE)


func _layout() -> void:
	var screen: Vector2 = Vector2(get_viewport().get_visible_rect().size)
	_gauge.position = Vector2(
		screen.x - MARGIN - _gauge.size.x, MARGIN
	)
	_label.size = Vector2(320.0, 26.0)
	_label.position = Vector2(
		screen.x - MARGIN - _label.size.x, MARGIN + _gauge.size.y + 4.0
	)


## Anneau qui se vide. Rouge dans le dernier quart : on doit sentir que ca
## se termine sans avoir a lire quoi que ce soit.
func _draw_gauge() -> void:
	if power_system == null or power_system.active == null:
		return
	var power: PowerData = power_system.active
	var center: Vector2 = _gauge.size * 0.5
	var ratio: float = power_system.remaining_ratio()

	_gauge.draw_circle(center, RADIUS, Color(0.0, 0.0, 0.0, 0.35))
	_gauge.draw_arc(center, RADIUS, 0.0, TAU, 48, Color(1, 1, 1, 0.18), RING_WIDTH)
	if ratio <= 0.0:
		return
	var color: Color = power.color
	if ratio <= WARNING_RATIO:
		color = Color(1.0, 0.35, 0.25)
	# On part du haut et on tourne dans le sens horaire.
	_gauge.draw_arc(
		center, RADIUS, -PI / 2.0, -PI / 2.0 + TAU * ratio, 48, color, RING_WIDTH
	)
	_gauge.draw_circle(center, RADIUS - RING_WIDTH - 3.0, Color(power.color, 0.55))
