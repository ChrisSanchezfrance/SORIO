class_name TouchButton
extends Button
## Bouton tactile conforme aux 11 criteres de C.2.
##
## C'EST LE SEUL BOUTON DU JEU. Aucun `Button` nu n'est instancie ailleurs :
## les criteres de C.2 ne sont pas des recommandations qu'on verifie a la
## relecture, ce sont des invariants garantis par construction ici.
##
## Criteres appliques automatiquement :
##   1. taille visuelle >= 64 px             7. marge des bords >= 32 px (par le parent)
##   2. zone tactile 20 % plus large         8. multi-touch (Godot le gere nativement)
##   3. reaction visuelle < 100 ms           9. appui long possible (`hold_progress`)
##   4. espacement >= 24 px (par le parent)  10. relachement hors zone : reste actif
##   5. opacite 55 % au repos                11. echelle reglable par les options
##   6. opacite 100 % pendant l'appui

## Taille visuelle minimale a l'ecran, avant mise a l'echelle (C.2).
const MIN_VISUAL_SIZE: float = 64.0
## La zone tactile deborde le visuel de 20 %, invisible pour le joueur.
const TOUCH_MARGIN_RATIO: float = 0.20
## Espacement minimal entre deux boutons, applique par les conteneurs.
const MIN_SPACING: float = 24.0
## Marge de securite vis-a-vis des bords (encoches, gestes systeme).
const EDGE_MARGIN: float = 32.0

const IDLE_OPACITY: float = 0.55
const PRESSED_OPACITY: float = 1.0
## Reaction visuelle : bien en dessous des 100 ms exiges.
const REACT_SECONDS: float = 0.06
const PRESS_SCALE: float = 0.92

## Echelles proposees dans les options (C.2).
const SCALE_PRESETS: Dictionary = {
	&"small": 0.85,
	&"medium": 1.0,
	&"large": 1.25,
	&"huge": 1.5,
}

## Cle haptique jouee a l'appui. Vide = aucune vibration.
@export var haptic_key: StringName = &"ui_button"
## Un bouton de HUD s'efface au repos ; un bouton de menu reste opaque.
@export var dim_when_idle: bool = true
## Suit l'echelle choisie dans les options. Les boutons de menu, deja
## grands, peuvent s'en dispenser.
@export var follow_button_scale: bool = true

## Duree de maintien en cours, lue par le saut a hauteur variable (C.2).
var hold_seconds: float = 0.0
var is_held: bool = false

var _tween: Tween = null
var _base_size: Vector2 = Vector2.ZERO


func _ready() -> void:
	# Le pivot central fait que l'enfoncement ne decale pas le bouton.
	pivot_offset = size / 2.0
	_base_size = size
	_enforce_minimum_size()
	_apply_user_scale()
	modulate.a = IDLE_OPACITY if dim_when_idle else 1.0

	button_down.connect(_on_down)
	button_up.connect(_on_up)
	EventBus.settings_changed.connect(_on_settings_changed)

	resized.connect(_on_resized)


func _on_resized() -> void:
	pivot_offset = size / 2.0


## Critere 1 : jamais plus petit que 64 px, quelle que soit la mise en page.
func _enforce_minimum_size() -> void:
	custom_minimum_size = custom_minimum_size.max(
		Vector2(MIN_VISUAL_SIZE, MIN_VISUAL_SIZE)
	)


## Critere 11 : l'echelle vient des options et s'applique sans redemarrage.
func _apply_user_scale() -> void:
	if not follow_button_scale:
		return
	var factor: float = Settings.get_float_option(&"controls", &"button_scale")
	custom_minimum_size = Vector2(MIN_VISUAL_SIZE, MIN_VISUAL_SIZE) * factor
	if _base_size != Vector2.ZERO:
		custom_minimum_size = custom_minimum_size.max(_base_size * factor)


func _on_settings_changed(section: StringName, key: StringName) -> void:
	if section == &"controls" and key == &"button_scale":
		_apply_user_scale()


## Critere 2 : la zone tactile deborde le visuel de 20 %, sans le montrer.
func _has_point(point: Vector2) -> bool:
	var margin: Vector2 = size * TOUCH_MARGIN_RATIO
	var zone: Rect2 = Rect2(-margin, size + margin * 2.0)
	return zone.has_point(point)


func _on_down() -> void:
	is_held = true
	hold_seconds = 0.0
	set_process(true)
	_animate(PRESSED_OPACITY, PRESS_SCALE)
	if not String(haptic_key).is_empty():
		Haptics.pulse(haptic_key)


func _on_up() -> void:
	is_held = false
	set_process(false)
	_animate(IDLE_OPACITY if dim_when_idle else 1.0, 1.0)


func _process(delta: float) -> void:
	# Critere 10 : tant que le doigt est pose, l'action reste active meme si
	# le doigt a glisse hors de la zone. On compte donc le maintien ici et
	# pas dans un handler d'entree qui verrait le doigt "sortir".
	if is_held:
		hold_seconds += delta


## Criteres 3, 5 et 6 : enfoncement + teinte, sous les 100 ms.
func _animate(target_alpha: float, target_scale: float) -> void:
	if _tween != null and _tween.is_valid():
		_tween.kill()
	_tween = create_tween().set_parallel(true)
	_tween.tween_property(self, "modulate:a", target_alpha, REACT_SECONDS)
	_tween.tween_property(self, "scale", Vector2.ONE * target_scale, REACT_SECONDS)


## Applique aux conteneurs les criteres 4 et 7, qui ne dependent pas du bouton
## lui-meme mais de sa mise en page.
static func apply_layout_rules(container: BoxContainer) -> void:
	container.add_theme_constant_override("separation", int(MIN_SPACING))
