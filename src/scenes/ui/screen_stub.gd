extends Control
## Ecran provisoire, remplace passe apres passe.
##
## Il existe pour une seule raison : la regle "aucun ecran mort, aucun bouton
## sans action" (C.6) doit tenir des la passe 0. Un ecran non encore construit
## affiche donc son nom et un bouton retour qui fonctionne vraiment, plutot
## qu'un plantage ou un bouton inerte.

## Cle de traduction du titre de l'ecran.
@export var title_key: String = "MENU_BACK"
## Passe a la description de la passe qui construira cet ecran.
@export var planned_in_pass: int = 0

const BACK_BUTTON_SIZE: Vector2 = Vector2(200.0, 72.0)


func _ready() -> void:
	$Title.text = tr(title_key)
	$Notice.text = "Ecran construit en passe %d" % planned_in_pass
	_build_back_button()
	EventBus.back_requested.connect(_on_back_requested)


func _build_back_button() -> void:
	var button: TouchButton = TouchButton.new()
	button.text = tr("MENU_BACK")
	button.dim_when_idle = false
	button.follow_button_scale = false
	button.custom_minimum_size = BACK_BUTTON_SIZE
	button.add_theme_font_size_override("font_size", 26)
	# Bouton retour visible en haut a gauche sur tous les ecrans (C.6).
	button.position = Vector2(TouchButton.EDGE_MARGIN, TouchButton.EDGE_MARGIN)
	button.pressed.connect(_go_back)
	add_child(button)


func _on_back_requested() -> void:
	if is_inside_tree() and visible:
		_go_back()


func _go_back() -> void:
	var went_back: bool = await Transition.go_back()
	if not went_back:
		await Transition.go_to(&"title", false)
