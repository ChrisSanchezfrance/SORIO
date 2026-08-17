extends TestCase
## Enchainement des niveaux et intermedes de mini-jeu (`LevelFlow`).
##
## Les quatre regles de l'intermede sont des promesses faites a un enfant de
## 8 ans : gratuit, sautable, jamais deux fois, jamais avant un boss. Elles
## sont donc verifiees ici plutot que relues.

## Monde type : 7 niveaux normaux + le niveau de boss en 8e position.
const LEVELS_IN_WORLD: int = 8

var _save: SaveData = null


func before_each() -> void:
	_save = SaveData.new()


# --- Enchainement de base ---------------------------------------------------

func test_normal_level_leads_to_next_level() -> void:
	var step: Dictionary = LevelFlow.next_step(_save, 1, 1, LEVELS_IN_WORLD)
	assert_eq(step["step"], LevelFlow.Step.NEXT_LEVEL)
	assert_eq(step["level"], 2)


func test_last_normal_level_leads_to_boss() -> void:
	var step: Dictionary = LevelFlow.next_step(_save, 1, 7, LEVELS_IN_WORLD)
	assert_eq(step["step"], LevelFlow.Step.BOSS)
	assert_eq(step["level"], 8)


func test_boss_level_leads_to_village() -> void:
	# Le cristal se rapporte a Papi : c'est le moteur emotionnel du jeu (A.1).
	var step: Dictionary = LevelFlow.next_step(_save, 1, 8, LEVELS_IN_WORLD)
	assert_eq(step["step"], LevelFlow.Step.VILLAGE)


# --- Regle 1 : l'intermede est gratuit --------------------------------------

func test_interlude_never_costs_amber() -> void:
	assert_false(
		LevelFlow.interlude_costs_amber(),
		"un mini-jeu impose entre deux niveaux ne peut pas etre payant"
	)


# --- Presence des intermedes ------------------------------------------------

func test_interlude_appears_every_three_levels() -> void:
	var step: Dictionary = LevelFlow.next_step(_save, 1, 3, LEVELS_IN_WORLD)
	assert_eq(step["step"], LevelFlow.Step.INTERLUDE)
	assert_ne(String(step["minigame"]), "", "un mini-jeu doit etre designe")


func test_no_interlude_on_other_levels() -> void:
	for level: int in [1, 2, 4, 5]:
		var step: Dictionary = LevelFlow.next_step(_save, 1, level, LEVELS_IN_WORLD)
		assert_ne(
			step["step"], LevelFlow.Step.INTERLUDE,
			"pas d'intermede apres le niveau %d" % level
		)


func test_interlude_target_is_a_known_minigame() -> void:
	var step: Dictionary = LevelFlow.next_step(_save, 1, 3, LEVELS_IN_WORLD)
	assert_has(
		LevelFlow.INTERLUDE_ROTATION, step["minigame"],
		"le mini-jeu choisi doit appartenir a la rotation"
	)


# --- Regle 4 : jamais juste avant un boss -----------------------------------

func test_no_interlude_right_before_the_boss() -> void:
	# Le niveau 6 est un multiple de 3, donc un intermede serait du. Mais le
	# niveau suivant est le 7, et le 8 est le boss... on verifie le cas ou le
	# prochain niveau EST le boss : ici avec un monde de 7 niveaux.
	const SHORT_WORLD: int = 7
	var step: Dictionary = LevelFlow.next_step(_save, 1, 6, SHORT_WORLD)
	assert_eq(
		step["step"], LevelFlow.Step.BOSS,
		"on n'interrompt pas la montee de tension juste avant l'arene"
	)


# --- Regle 3 : jamais deux fois au meme endroit -----------------------------

func test_interlude_not_repeated_once_played() -> void:
	var first: Dictionary = LevelFlow.next_step(_save, 1, 3, LEVELS_IN_WORLD)
	assert_eq(first["step"], LevelFlow.Step.INTERLUDE)

	LevelFlow.mark_interlude_done(_save, 1, 3)

	var second: Dictionary = LevelFlow.next_step(_save, 1, 3, LEVELS_IN_WORLD)
	assert_eq(
		second["step"], LevelFlow.Step.NEXT_LEVEL,
		"rejouer le niveau ne doit pas reimposer le mini-jeu"
	)


func test_skipping_counts_as_done() -> void:
	# Regle 2 : passer un intermede le marque aussi. Reproposer ce que
	# l'enfant vient de refuser serait du harcelement.
	LevelFlow.mark_interlude_done(_save, 2, 3)
	assert_true(LevelFlow.has_played_interlude(_save, 2, 3))
	var step: Dictionary = LevelFlow.next_step(_save, 2, 3, LEVELS_IN_WORLD)
	assert_ne(step["step"], LevelFlow.Step.INTERLUDE)


func test_mark_done_is_idempotent() -> void:
	LevelFlow.mark_interlude_done(_save, 1, 3)
	LevelFlow.mark_interlude_done(_save, 1, 3)
	assert_eq(_save.interludes_done.size(), 1, "aucun doublon dans la sauvegarde")


# --- Variete ----------------------------------------------------------------

func test_rotation_is_deterministic() -> void:
	# Le meme endroit du jeu donne toujours le meme mini-jeu : un enfant peut
	# l'anticiper et le raconter.
	var a: StringName = LevelFlow.interlude_for(SaveData.new(), 3, 3)
	var b: StringName = LevelFlow.interlude_for(SaveData.new(), 3, 3)
	assert_eq(a, b)


func test_consecutive_interludes_differ() -> void:
	# Deux intermedes d'affilee ne doivent pas etre le meme mini-jeu, sinon
	# la respiration devient une corvee.
	var first: StringName = LevelFlow.interlude_for(SaveData.new(), 1, 3)
	var second: StringName = LevelFlow.interlude_for(SaveData.new(), 1, 6)
	assert_ne(first, second)


func test_rotation_covers_all_ten_minigames() -> void:
	assert_eq(
		LevelFlow.INTERLUDE_ROTATION.size(), 10,
		"les 10 mini-jeux de A.10 doivent tous pouvoir tomber en intermede"
	)
	var seen: Array[StringName] = []
	for id: StringName in LevelFlow.INTERLUDE_ROTATION:
		assert_false(seen.has(id), "doublon dans la rotation : %s" % id)
		seen.append(id)


func test_every_rotation_entry_exists_in_database() -> void:
	# Un mini-jeu cite dans la rotation mais absent des .tres provoquerait
	# un ecran vide en pleine partie.
	for id: StringName in LevelFlow.INTERLUDE_ROTATION:
		assert_true(
			Database.has("minigames", id),
			"mini-jeu declare dans la rotation mais absent des ressources : %s" % id
		)


# --- Donnees des mini-jeux --------------------------------------------------

func test_all_minigames_are_valid() -> void:
	for resource: Resource in Database.all("minigames"):
		var data: MinigameData = resource as MinigameData
		var problems: PackedStringArray = data.validate()
		assert_eq(problems.size(), 0, "  ".join(problems))


func test_interlude_is_shorter_than_camp_session() -> void:
	# Couper l'aventure plus de 30 s casserait l'elan du niveau suivant.
	for resource: Resource in Database.all("minigames"):
		var data: MinigameData = resource as MinigameData
		if not data.usable_as_interlude:
			continue
		assert_lt(
			data.interlude_duration_seconds, data.duration_seconds + 0.1,
			"%s : la version intermede doit etre au plus aussi longue" % data.id
		)
		assert_lt(
			data.interlude_duration_seconds, 35.0,
			"%s : un intermede de plus de 35 s casse le rythme" % data.id
		)
