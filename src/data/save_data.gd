class_name SaveData
extends Resource
## Contenu d'un emplacement de sauvegarde (B.8).
##
## Format `Resource` volontairement lisible : on peut ouvrir un `save_1.tres`
## dans un editeur de texte pour deboguer une partie sans outil special.
##
## `version` ne descend jamais. Toute montee de version passe par
## `SaveManager.MIGRATIONS` ; une sauvegarde ancienne se migre, elle ne se
## perd jamais et ne se corrompt jamais.

## Version du schema. A incrementer a CHAQUE changement de champ,
## accompagne d'une fonction de migration dans SaveManager.
const CURRENT_VERSION: int = 1

@export var version: int = CURRENT_VERSION

# --- Identite de la partie --------------------------------------------------

@export var slot: int = 1
@export var created_at: int = 0          ## horodatage Unix
@export var updated_at: int = 0
@export var play_time_seconds: float = 0.0

# --- Progression ------------------------------------------------------------

@export var world_reached: int = 1       ## 1 a 8
@export var level_reached: int = 1
@export var crystals: Array[int] = []    ## indices des mondes dont le cristal est pris
## "monde_niveau" -> nombre d'etoiles (0 a 3). Ex. : "1_3" -> 2
@export var stars: Dictionary = {}
## Niveaux bonus deverrouilles, par index de monde.
@export var bonus_unlocked: Array[int] = []

# --- Economie ---------------------------------------------------------------

@export var amber: int = 0
@export var shards: int = 0
@export var lives: int = 3
## Ambres cumules depuis la derniere vie gagnee (une vie tous les 100).
@export var amber_toward_life: int = 0

# --- Inventaire et ameliorations --------------------------------------------

@export var upgrades: Dictionary = {}    ## id d'amelioration -> niveau
@export var cosmetics_owned: Array[StringName] = []
@export var cosmetic_outfit: StringName = &"default"
@export var cosmetic_scarf: StringName = &"red"
@export var cosmetic_piko: StringName = &"default"
## Pouvoir conserve dans la poche entre les niveaux (A.6).
@export var pocket_power: StringName = &""

# --- Collection (A.6.4) -----------------------------------------------------

@export var powers_discovered: Array[StringName] = []
@export var power_use_counts: Dictionary = {}   ## id -> nombre d'utilisations
@export var enemies_discovered: Array[StringName] = []
@export var bosses_defeated: Array[StringName] = []

# --- Scores -----------------------------------------------------------------

@export var minigame_best: Dictionary = {}      ## id de mini-jeu -> meilleur score
## Mini-jeux deja proposes en intermede, sous la forme "monde_niveau".
## Un intermede joue OU passe y entre : on ne represente jamais deux fois
## le meme au meme endroit (LevelFlow, regle 3).
@export var interludes_done: Array[String] = []
## Mini-jeux deja rencontres, donc rejouables depuis le Camp.
@export var minigames_discovered: Array[StringName] = []
@export var runner_best_distance: float = 0.0
@export var level_best_time: Dictionary = {}    ## "monde_niveau" -> secondes

# --- Didacticiel et assistance ----------------------------------------------

## Etapes du didacticiel deja apprises (C.4). Une etape apprise ne se
## reaffiche jamais, meme sur une nouvelle partie du meme emplacement.
@export var tutorial_steps_done: Array[int] = []
## Astuces contextuelles deja vues (C.5) : une seule fois par partie.
@export var hints_seen: Array[StringName] = []
@export var tutorial_skipped: bool = false
@export var assist_mode_offered: bool = false


## Pourcentage de complétion, affiche sur l'ecran de selection (C.6.3).
func completion_percent() -> int:
	var total_stars: int = 0
	for key: String in stars:
		total_stars += int(stars[key])
	# 8 mondes x 8 niveaux x 3 etoiles = 192 au maximum theorique.
	const MAX_STARS: int = 192
	return clampi(roundi(100.0 * float(total_stars) / float(MAX_STARS)), 0, 100)


func star_count(world_index: int, level_index: int) -> int:
	return int(stars.get("%d_%d" % [world_index, level_index], 0))


func set_star_count(world_index: int, level_index: int, value: int) -> void:
	var key: String = "%d_%d" % [world_index, level_index]
	# On ne redescend jamais le score d'un niveau deja mieux reussi.
	stars[key] = maxi(star_count(world_index, level_index), clampi(value, 0, 3))


func stars_in_world(world_index: int) -> int:
	var total: int = 0
	for key: String in stars:
		if key.begins_with("%d_" % world_index):
			total += int(stars[key])
	return total


func is_fresh() -> bool:
	return created_at == 0
