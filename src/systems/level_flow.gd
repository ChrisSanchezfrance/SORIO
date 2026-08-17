class_name LevelFlow
extends RefCounted
## Ce qui se passe APRES un niveau.
##
## Un seul endroit decide de l'enchainement du jeu : niveau suivant,
## intermede de mini-jeu, Village, carte du monde. Sans ce fichier, cette
## logique se disperserait dans chaque ecran et deviendrait impossible a
## suivre.
##
## LES MINI-JEUX SONT DANS L'AVENTURE, pas seulement au Camp. Ils tombent
## entre deux niveaux, comme une respiration. Quatre regles encadrent ca,
## et elles decoulent toutes du meme principe : un enfant de 8 ans ne doit
## jamais etre bloque ni puni.
##
##   1. **Gratuit.** Un intermede ne coute aucun ambre et ne consomme pas
##      une des 3 parties gratuites du Camp.
##   2. **Sautable.** Un bouton "Passer" toujours present. Un enfant qui
##      n'aime pas un mini-jeu ne doit pas rester coince devant.
##   3. **Jamais deux fois.** Un intermede joue est marque dans la
##      sauvegarde et ne se represente plus au meme endroit.
##   4. **Jamais avant un boss.** On n'interrompt pas la montee de tension
##      juste avant l'arene.
##
## Le Camp reste en place : on y rejoue n'importe quel mini-jeu deja
## rencontre, avec l'economie de A.10.

enum Step {
	NEXT_LEVEL,   ## on enchaine sur le niveau suivant du monde
	INTERLUDE,    ## un mini-jeu s'intercale
	BOSS,         ## le niveau de boss du monde
	VILLAGE,      ## cristal rapporte a Papi, entre deux mondes
	WORLD_MAP,    ## retour a la carte
}

## Rythme par defaut : un intermede tous les N niveaux termines.
## Assez rare pour rester une surprise, assez frequent pour rythmer un monde
## de 6 a 8 niveaux — soit deux intermedes par monde.
const INTERLUDE_EVERY: int = 3

## Ordre de rotation des mini-jeux en intermede. Deterministe : le meme
## endroit du jeu donne toujours le meme mini-jeu, donc un enfant peut
## l'anticiper et le raconter, et un test peut le verifier.
const INTERLUDE_ROTATION: Array[StringName] = [
	&"egg_hunt", &"raptor_race", &"fossil_dig", &"lily_hop", &"ptero_shoot",
	&"crystal_memory", &"nest_defense", &"lava_slide", &"vine_swing", &"amber_crack",
]


## Decide de la suite apres un niveau termine.
##
## `levels_in_world` inclut le niveau de boss. Retourne un dictionnaire
## `{"step": Step, "minigame": StringName, "world": int, "level": int}`.
static func next_step(
	save: SaveData, world_index: int, level_index: int, levels_in_world: int
) -> Dictionary:
	assert(save != null, "LevelFlow.next_step sans sauvegarde")
	assert(world_index >= 1, "monde invalide : %d" % world_index)
	assert(level_index >= 1, "niveau invalide : %d" % level_index)

	# Le niveau de boss vient d'etre termine : le cristal part au Village.
	if level_index >= levels_in_world:
		return _step(Step.VILLAGE, world_index, level_index)

	var next_level: int = level_index + 1
	var next_is_boss: bool = next_level >= levels_in_world

	# Regle 4 : jamais d'intermede juste avant l'arene.
	if not next_is_boss:
		var minigame: StringName = interlude_for(save, world_index, level_index)
		if not String(minigame).is_empty():
			return _step(Step.INTERLUDE, world_index, level_index, minigame)

	if next_is_boss:
		return _step(Step.BOSS, world_index, next_level)
	return _step(Step.NEXT_LEVEL, world_index, next_level)


## Mini-jeu a intercaler apres ce niveau, ou `&""` s'il n'y en a pas.
static func interlude_for(
	save: SaveData, world_index: int, level_index: int
) -> StringName:
	if level_index % INTERLUDE_EVERY != 0:
		return &""
	if has_played_interlude(save, world_index, level_index):
		return &""  # regle 3 : jamais deux fois au meme endroit
	return _rotation_pick(world_index, level_index)


## Choix deterministe dans la rotation : on avance d'un cran a chaque
## intermede rencontre depuis le debut de l'aventure.
static func _rotation_pick(world_index: int, level_index: int) -> StringName:
	var slot: int = (world_index - 1) * 2 + (level_index / INTERLUDE_EVERY) - 1
	return INTERLUDE_ROTATION[posmod(slot, INTERLUDE_ROTATION.size())]


static func interlude_key(world_index: int, level_index: int) -> String:
	return "%d_%d" % [world_index, level_index]


static func has_played_interlude(
	save: SaveData, world_index: int, level_index: int
) -> bool:
	return interlude_key(world_index, level_index) in save.interludes_done


## Marque l'intermede comme vu. Appele AUSSI quand le joueur passe :
## proposer deux fois de suite ce qu'il vient de refuser serait du harcelement.
static func mark_interlude_done(
	save: SaveData, world_index: int, level_index: int
) -> void:
	var key: String = interlude_key(world_index, level_index)
	if key in save.interludes_done:
		return
	save.interludes_done.append(key)


## Un intermede est toujours gratuit (regle 1).
static func interlude_costs_amber() -> bool:
	return false


static func _step(
	step: Step, world_index: int, level_index: int, minigame: StringName = &""
) -> Dictionary:
	return {
		"step": step,
		"world": world_index,
		"level": level_index,
		"minigame": minigame,
	}
