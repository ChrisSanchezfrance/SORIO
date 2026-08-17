class_name PlayerConfig
extends Resource
## Physique de SORIO (B.4).
##
## Toutes les valeurs vivent ici et nulle part ailleurs : le panneau de debug
## (F1) les modifie en direct, et `lint_levels` s'en sert pour calculer la
## portee reelle du joueur. Changer un chiffre ici change le jeu ET la
## validation des niveaux, automatiquement.
##
## Unites : pixels et secondes. 1 tuile = 64 px.

@export_group("Deplacement au sol")
## Acceleration de la pesanteur.
@export var gravity: float = 3600.0
## Vitesse de pointe en course.
@export var run_speed: float = 440.0
## Vivacite du demarrage.
@export var run_acceleration: float = 2800.0
## Vivacite de l'arret quand aucune direction n'est tenue.
@export var run_friction: float = 2400.0

@export_group("Saut")
## Impulsion verticale. Negative : l'axe Y descend en 2D.
@export var jump_velocity: float = -1240.0
## Relacher le bouton coupe le saut en cours (saut a hauteur variable).
@export var jump_cut_multiplier: float = 0.45
## Facteur d'acceleration en l'air par rapport au sol.
@export var air_control: float = 0.75
## Vitesse de chute maximale.
@export var max_fall_speed: float = 1800.0

@export_group("Confort de saut")
## Saut encore accepte apres avoir quitte le sol.
## NON OPTIONNEL : c'est ce qui separe un jeu agreable d'un jeu frustrant.
@export var coyote_time: float = 0.10
## Saut memorise avant l'atterrissage, rejoue des le contact.
@export var jump_buffer: float = 0.12

@export_group("Interactions")
## Rebond apres avoir ecrase un ennemi.
@export var stomp_bounce: float = -840.0
## Duree d'invincibilite apres un degat.
@export var invincibility_time: float = 1.2
## Friction du monde 4 : sol glissant (friction divisee par 4).
@export var ice_friction_factor: float = 0.25


# --- Portee du joueur -------------------------------------------------------
#
# Ces trois fonctions sont la raison d'etre de cette ressource. `lint_levels`
# les appelle pour verifier qu'un niveau est franchissable : un saut qui
# demande plus que ces valeurs est un blocage de progression, detecte
# automatiquement plutot qu'apres dix heures de test manuel.

## Hauteur maximale d'un saut, en pixels. h = v^2 / (2g).
func max_jump_height() -> float:
	return (jump_velocity * jump_velocity) / (2.0 * gravity)


## Duree totale d'un saut complet, montee plus descente, en secondes.
func jump_airtime() -> float:
	return 2.0 * absf(jump_velocity) / gravity


## Portee horizontale maximale d'un saut, en pixels.
## Hypothese volontairement prudente : le joueur est deja lance a pleine
## vitesse au moment de l'impulsion. Le lint reste donc du cote sur.
func max_jump_distance() -> float:
	return run_speed * jump_airtime()


## Meme portee, exprimee en tuiles de 64 px.
func max_jump_height_tiles() -> float:
	return max_jump_height() / 64.0


func max_jump_distance_tiles() -> float:
	return max_jump_distance() / 64.0


## Verifie la coherence des valeurs. Appelee au demarrage et par les tests :
## une configuration absurde doit se voir tout de suite.
func validate() -> PackedStringArray:
	var problems: PackedStringArray = PackedStringArray()
	if gravity <= 0.0:
		problems.append("gravity doit etre positive")
	if jump_velocity >= 0.0:
		problems.append("jump_velocity doit etre negative (l'axe Y descend)")
	if run_speed <= 0.0:
		problems.append("run_speed doit etre positive")
	if coyote_time <= 0.0:
		problems.append("coyote_time nul : le saut deviendra frustrant (B.4)")
	if jump_buffer <= 0.0:
		problems.append("jump_buffer nul : le saut deviendra frustrant (B.4)")
	if jump_cut_multiplier < 0.0 or jump_cut_multiplier > 1.0:
		problems.append("jump_cut_multiplier doit etre entre 0 et 1")
	if max_fall_speed <= absf(jump_velocity):
		problems.append("max_fall_speed trop basse : la chute plafonnerait avant la montee")
	return problems
