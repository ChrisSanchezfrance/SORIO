extends Control
## Ecran titre (C.6.2).
##
## Le menu est construit par code a partir d'une table : chaque entree est un
## `TouchButton`, donc les 11 criteres de C.2 sont respectes par construction
## et l'espacement de 24 px ne peut pas etre oublie.

## Libelle de traduction -> ecran cible. L'ordre est celui de l'affichage.
const ENTRIES: Array[Dictionary] = [
	{"key": "MENU_PLAY", "screen": &"platformer"},
	{"key": "MENU_MINIGAMES", "screen": &"camp"},
	{"key": "MENU_SHOP", "screen": &"shop"},
	{"key": "MENU_COLLECTION", "screen": &"collection"},
	{"key": "MENU_OPTIONS", "screen": &"options"},
	{"key": "MENU_CREDITS", "screen": &"credits"},
]

## Hauteur a 64 px : c'est le plancher de C.2, et c'est ce qui fait tenir
## les six entrees plus leurs 24 px d'espacement dans un ecran 720 px.
const MENU_BUTTON_SIZE: Vector2 = Vector2(420.0, 64.0)

@onready var _menu: VBoxContainer = $Menu
@onready var _skip_tutorial: CheckBox = $SkipTutorial


func _ready() -> void:
	$Title.text = tr("GAME_TITLE")
	$Subtitle.text = tr("GAME_SUBTITLE")
	_build_menu()
	_setup_skip_tutorial()
	EventBus.back_requested.connect(_on_back_requested)


func _build_menu() -> void:
	TouchButton.apply_layout_rules(_menu)
	for entry: Dictionary in ENTRIES:
		var button: TouchButton = TouchButton.new()
		button.text = tr(String(entry["key"]))
		# Un bouton de menu reste pleinement lisible : il ne masque aucun jeu.
		button.dim_when_idle = false
		button.follow_button_scale = false
		button.custom_minimum_size = MENU_BUTTON_SIZE
		button.add_theme_font_size_override("font_size", 28)
		var target: StringName = entry["screen"]
		button.pressed.connect(_on_entry_pressed.bind(target))
		_menu.add_child(button)


## Case "Je sais deja jouer" : desactive entierement le didacticiel (C.4).
func _setup_skip_tutorial() -> void:
	_skip_tutorial.text = tr("MENU_SKIP_TUTORIAL")
	_skip_tutorial.button_pressed = not Settings.get_bool(
		&"accessibility", &"tutorial_enabled"
	)
	_skip_tutorial.toggled.connect(_on_skip_toggled)


func _on_skip_toggled(pressed: bool) -> void:
	Settings.set_option(&"accessibility", &"tutorial_enabled", not pressed)


func _on_entry_pressed(screen: StringName) -> void:
	Transition.go_to(screen)


## Bouton retour Android sur l'ecran titre : demande confirmation (D.4).
func _on_back_requested() -> void:
	if not is_inside_tree() or not visible:
		return
	_confirm_quit()


func _confirm_quit() -> void:
	var dialog: ConfirmationDialog = ConfirmationDialog.new()
	dialog.dialog_text = tr("MENU_QUIT_CONFIRM")
	dialog.ok_button_text = tr("MENU_YES")
	dialog.cancel_button_text = tr("MENU_NO")
	dialog.confirmed.connect(func() -> void: get_tree().quit())
	dialog.close_requested.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered()
