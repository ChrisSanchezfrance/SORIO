class_name MinigameData
extends Resource
## Definition d'un mini-jeu (A.10).
##
## Les 10 mini-jeux ne different que par ces donnees et par leur logique
## propre : `MinigameBase` fournit le compte a rebours, le score, l'ecran de
## regles de 3 s et la recompense.
##
## CHANGEMENT PAR RAPPORT A LA SPEC D'ORIGINE : un mini-jeu n'est plus
## seulement une tuile du Camp. Il s'invite AUSSI entre deux niveaux, en
## intermede (voir `LevelFlow`). Les deux usages partagent la meme scene ;
## seuls le cout et la recompense changent.

@export var id: StringName = &""
@export var name_key: String = ""
@export var rules_key: String = ""

@export_group("Controle")
## Geste principal, qui determine le pictogramme anime de l'ecran de regles.
## Aucun texte n'est necessaire pour comprendre (A.10).
@export_enum("drag", "tap", "rhythm", "aim", "sequence", "place", "swipe")
var control_type: String = "tap"

@export_group("Partie")
## Duree cible, 30 a 60 s (A.10).
@export var duration_seconds: float = 45.0
## Monde a partir duquel le mini-jeu apparait.
@export var unlocked_from_world: int = 1

@export_group("Recompenses")
## Pouvoirs ou objets que ce mini-jeu peut donner.
@export var reward_item_ids: Array[StringName] = []
## Ambres accordes pour un bon score.
@export var reward_amber: int = 0
## Fragments de cristal (monnaie rare) accordes.
@export var reward_shards: int = 0

@export_group("Intermede")
## Un mini-jeu peut etre reserve au Camp s'il se prete mal a une coupure
## courte entre deux niveaux.
@export var usable_as_interlude: bool = true
## Duree raccourcie quand il sert d'intermede : couper l'aventure plus de
## 30 s casserait l'elan du niveau suivant.
@export var interlude_duration_seconds: float = 30.0


func validate() -> PackedStringArray:
	var problems: PackedStringArray = PackedStringArray()
	if String(id).is_empty():
		problems.append("id vide")
	if name_key.is_empty():
		problems.append("%s : name_key vide" % id)
	if duration_seconds < 20.0 or duration_seconds > 90.0:
		problems.append("%s : duree hors des 30-60 s de A.10" % id)
	if unlocked_from_world < 1 or unlocked_from_world > 8:
		problems.append("%s : monde de deverrouillage hors bornes" % id)
	return problems
