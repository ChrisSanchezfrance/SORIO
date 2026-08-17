extends Control
## Ecran de demarrage (C.6.1).
##
## Ne fait rien de spectaculaire, mais garantit un point d'entree unique :
## les autoloads sont prets, la langue est appliquee, la base est indexee,
## puis on part sur le titre. Objectif D.6 : moins de 5 s sur un telephone
## d'entree de gamme, donc aucun chargement lourd ici.

## Duree minimale d'affichage, pour que le logo ne clignote pas sur un
## appareil rapide. On n'attend jamais plus que ca.
const MIN_DISPLAY_SECONDS: float = 0.8

@onready var _title_label: Label = $Title
@onready var _status_label: Label = $Status


func _ready() -> void:
	_title_label.text = tr("GAME_TITLE")
	_status_label.text = tr("BOOT_LOADING")
	_boot()


func _boot() -> void:
	var started: int = Time.get_ticks_msec()

	# Verification de coherence : si la base a des erreurs, on veut le savoir
	# ici et pas au milieu d'un niveau.
	if not Database.load_errors.is_empty():
		push_error("[Boot] %d erreur(s) de contenu" % Database.load_errors.size())

	var elapsed: float = float(Time.get_ticks_msec() - started) / 1000.0
	if elapsed < MIN_DISPLAY_SECONDS:
		await get_tree().create_timer(MIN_DISPLAY_SECONDS - elapsed).timeout

	Transition.clear_history()
	await Transition.go_to(&"title", false)
