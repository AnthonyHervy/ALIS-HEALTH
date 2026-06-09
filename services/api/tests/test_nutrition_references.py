import pytest
import gzip
from openpyxl import Workbook
from sqlalchemy import select

from app.models import NutritionFoodReference
from app.services.nutrition.importer import NutritionDatasetImporter
from app.services.nutrition.references import NutritionReferenceService


@pytest.mark.asyncio
async def test_reference_service_prefers_open_food_facts_barcode(db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-yogurt",
                name="Yaourt nature",
                energy_kcal_100g=61,
                protein_g_100g=3.5,
                carbohydrates_g_100g=4.7,
                fat_g_100g=3.3,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="openfoodfacts",
                source_id="off-yogurt",
                barcode="3017620422003",
                name="Yaourt nature industriel",
                energy_kcal_100g=89,
                protein_g_100g=4.1,
                carbohydrates_g_100g=12,
                fat_g_100g=2.8,
                dataset_version="off-test",
            ),
        ]
    )
    await db_session.commit()

    service = NutritionReferenceService(db_session)

    match = await service.match_item({"name": "Yaourt nature", "barcode": "3017620422003"})

    assert match is not None
    assert match.source == "openfoodfacts"
    assert match.barcode == "3017620422003"


@pytest.mark.asyncio
async def test_reference_service_falls_back_to_ciqual_name_match(db_session):
    db_session.add(
        NutritionFoodReference(
            source="ciqual",
            source_id="ciqual-banana",
            name="Banane, pulpe, crue",
            energy_kcal_100g=90,
            protein_g_100g=1.1,
            carbohydrates_g_100g=19.7,
            fat_g_100g=0.3,
            dataset_version="ciqual-2025-test",
        )
    )
    await db_session.commit()

    match = await NutritionReferenceService(db_session).match_item({"name": "Banane"})

    assert match is not None
    assert match.source == "ciqual"
    assert match.source_id == "ciqual-banana"


@pytest.mark.asyncio
async def test_reference_service_matches_common_short_names_to_ciqual_labels(db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-roast-chicken",
                name="Poulet, viande et peau, rôti/cuit au four",
                energy_kcal_100g=215,
                protein_g_100g=27,
                carbohydrates_g_100g=0,
                fat_g_100g=12,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-sweet-potato",
                name="Patate douce, cuite",
                energy_kcal_100g=86,
                protein_g_100g=1.6,
                carbohydrates_g_100g=20,
                fat_g_100g=0.1,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-roast-potato",
                name="Pomme de terre, rôtie/cuite au four",
                energy_kcal_100g=150,
                protein_g_100g=2.5,
                carbohydrates_g_100g=27,
                fat_g_100g=4,
                dataset_version="ciqual-2025-test",
            ),
        ]
    )
    await db_session.commit()

    service = NutritionReferenceService(db_session)

    chicken = await service.match_item({"name": "Poulet rôti"})
    sweet_potato = await service.match_item({"name": "Patates douces"})
    potato = await service.match_item({"name": "Pommes de terre rôties"})

    assert chicken is not None
    assert chicken.source_id == "ciqual-roast-chicken"
    assert sweet_potato is not None
    assert sweet_potato.source_id == "ciqual-sweet-potato"
    assert potato is not None
    assert potato.source_id == "ciqual-roast-potato"


@pytest.mark.asyncio
async def test_reference_service_prefers_generic_cooked_ciqual_matches(db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-processed-chicken",
                name="Poulet, manchons marinés, préemballés, rôtis/cuits au four",
                energy_kcal_100g=213,
                protein_g_100g=24,
                carbohydrates_g_100g=0,
                fat_g_100g=12,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-generic-roast-chicken",
                name="Poulet, viande et peau rôties/cuites au four",
                energy_kcal_100g=204,
                protein_g_100g=27,
                carbohydrates_g_100g=0,
                fat_g_100g=11,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-raw-sweet-potato",
                name="Patate douce, crue",
                energy_kcal_100g=81.2,
                protein_g_100g=1.7,
                carbohydrates_g_100g=17.7,
                fat_g_100g=0.1,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-cooked-sweet-potato",
                name="Patate douce, cuite",
                energy_kcal_100g=79.1,
                protein_g_100g=1.7,
                carbohydrates_g_100g=16.9,
                fat_g_100g=0.1,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-raw-broccoli",
                name="Brocoli, cru",
                energy_kcal_100g=31.9,
                protein_g_100g=3.1,
                carbohydrates_g_100g=2.4,
                fat_g_100g=0.4,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-cooked-broccoli",
                name="Brocoli, cuit (aliment moyen)",
                energy_kcal_100g=30,
                protein_g_100g=3,
                carbohydrates_g_100g=2,
                fat_g_100g=0.6,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-raw-mushroom",
                name="Champignon de Paris ou champignon de couche, cru",
                energy_kcal_100g=21,
                protein_g_100g=2.6,
                carbohydrates_g_100g=1.3,
                fat_g_100g=0.4,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-cooked-mushroom",
                name="Champignon de Paris ou champignon de couche, sauté/poêlé, sans matière grasse",
                energy_kcal_100g=38.4,
                protein_g_100g=4.1,
                carbohydrates_g_100g=2.1,
                fat_g_100g=0.7,
                dataset_version="ciqual-2025-test",
            ),
        ]
    )
    await db_session.commit()

    service = NutritionReferenceService(db_session)

    chicken = await service.match_item({"name": "Poulet rôti"})
    sweet_potato = await service.match_item({"name": "Patates douces"})
    broccoli = await service.match_item({"name": "Brocolis"})
    mushrooms = await service.match_item({"name": "Champignons rôtis"})

    assert chicken is not None
    assert chicken.source_id == "ciqual-generic-roast-chicken"
    assert sweet_potato is not None
    assert sweet_potato.source_id == "ciqual-cooked-sweet-potato"
    assert broccoli is not None
    assert broccoli.source_id == "ciqual-cooked-broccoli"
    assert mushrooms is not None
    assert mushrooms.source_id == "ciqual-cooked-mushroom"


@pytest.mark.asyncio
async def test_reference_service_matches_pasta_shapes_to_generic_cooked_pasta(db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-pasta-cooked",
                name="Pâtes sèches, standard, cuites, sans sel ajouté",
                energy_kcal_100g=167,
                protein_g_100g=5.8,
                carbohydrates_g_100g=30.9,
                fat_g_100g=1.1,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-fruit-paste",
                name="Pâte de fruits",
                energy_kcal_100g=336,
                protein_g_100g=0,
                carbohydrates_g_100g=82,
                fat_g_100g=0,
                dataset_version="ciqual-2025-test",
            ),
        ]
    )
    await db_session.commit()

    match = await NutritionReferenceService(db_session).match_item({"name": "pâtes penne"})

    assert match is not None
    assert match.source_id == "ciqual-pasta-cooked"


@pytest.mark.asyncio
async def test_reference_search_ranks_fuzzy_cooked_food_matches(db_session):
    db_session.add_all(
        [
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-processed-chicken",
                name="Poulet, manchons marinés, préemballés, rôtis/cuits au four",
                energy_kcal_100g=213,
                protein_g_100g=24,
                carbohydrates_g_100g=0,
                fat_g_100g=12,
                dataset_version="ciqual-2025-test",
            ),
            NutritionFoodReference(
                source="ciqual",
                source_id="ciqual-generic-roast-chicken",
                name="Poulet, viande et peau rôties/cuites au four",
                energy_kcal_100g=204,
                protein_g_100g=27,
                carbohydrates_g_100g=0,
                fat_g_100g=11,
                dataset_version="ciqual-2025-test",
            ),
        ]
    )
    await db_session.commit()

    results = await NutritionReferenceService(db_session).search("Poulet roti")

    assert [result.source_id for result in results[:2]] == [
        "ciqual-generic-roast-chicken",
        "ciqual-processed-chicken",
    ]


@pytest.mark.asyncio
async def test_reference_service_returns_none_for_unknown_food(db_session):
    match = await NutritionReferenceService(db_session).match_item({"name": "Plat introuvable"})

    assert match is None


@pytest.mark.asyncio
async def test_dataset_importer_loads_ciqual_and_open_food_facts_exports(db_session, tmp_path):
    ciqual = tmp_path / "ciqual.csv"
    ciqual.write_text(
        "alim_code,alim_nom_fr,energy_kcal_100g,protein_g_100g,carbohydrates_g_100g,fat_g_100g\n"
        "1001,Riz cuit,130,2.7,28,0.3\n",
        encoding="utf-8",
    )
    off = tmp_path / "off.csv"
    off.write_text(
        "code,product_name,energy-kcal_100g,proteins_100g,carbohydrates_100g,fat_100g\n"
        "1234567890123,Sauce soja test,53,8,5,0\n",
        encoding="utf-8",
    )

    importer = NutritionDatasetImporter(db_session)
    ciqual_count = await importer.import_ciqual_csv(ciqual, dataset_version="ciqual-2025-test")
    off_count = await importer.import_open_food_facts_csv(off, dataset_version="off-test")
    await db_session.commit()

    assert ciqual_count == 1
    assert off_count == 1
    rows = (await db_session.execute(select(NutritionFoodReference))).scalars().all()
    assert {row.source for row in rows} == {"ciqual", "openfoodfacts"}
    assert {row.dataset_version for row in rows} == {"ciqual-2025-test", "off-test"}


@pytest.mark.asyncio
async def test_dataset_importer_loads_ciqual_2025_xlsx_export(db_session, tmp_path):
    path = tmp_path / "Table Ciqual 2025_FR_2025_11_03.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "composition nutritionnelle"
    sheet.append(
        [
            "alim_code",
            "alim_nom_fr",
            "Energie,\nRèglement\nUE N°\n1169\n2011 (kcal\n100 g)",
            "Protéines,\nN x\nfacteur de\nJones (g\n100 g)",
            "Glucides\n(g\n100 g)",
            "Lipides\n(g\n100 g)",
        ]
    )
    sheet.append(["4004", "Poulet, viande et peau, rôti/cuit au four", "215", "27", "0", "12"])
    workbook.save(path)

    count = await NutritionDatasetImporter(db_session).import_ciqual_xlsx(path, dataset_version="ciqual-2025-test")
    await db_session.commit()

    row = (await db_session.execute(select(NutritionFoodReference))).scalar_one()
    assert count == 1
    assert row.source == "ciqual"
    assert row.source_id == "4004"
    assert row.name == "Poulet, viande et peau, rôti/cuit au four"
    assert row.energy_kcal_100g == 215
    assert row.protein_g_100g == 27


@pytest.mark.asyncio
async def test_dataset_importer_reads_compressed_open_food_facts_export(db_session, tmp_path):
    off = tmp_path / "off.csv.gz"
    with gzip.open(off, "wt", encoding="utf-8") as handle:
        handle.write(
            "code,product_name,energy-kcal_100g,proteins_100g,carbohydrates_100g,fat_100g\n"
            "9876543210987,Compote test,72,0.4,16,0.1\n"
        )

    count = await NutritionDatasetImporter(db_session).import_open_food_facts_csv(off, dataset_version="off-gz-test")
    await db_session.commit()

    row = (await db_session.execute(select(NutritionFoodReference))).scalar_one()
    assert count == 1
    assert row.barcode == "9876543210987"
    assert row.name == "Compote test"
    assert row.dataset_version == "off-gz-test"


@pytest.mark.asyncio
async def test_dataset_importer_reads_official_open_food_facts_export_columns(db_session, tmp_path):
    off = tmp_path / "openfoodfacts-products.csv.gz"
    with gzip.open(off, "wt", encoding="utf-8") as handle:
        handle.write(
            "code\tproduct_name\tproduct_name_fr\tenergy_100g\tproteins_100g\tcarbohydrates_100g\tfat_100g\n"
            "3017620422003\tHazelnut spread\tPâte à tartiner noisettes\t836\t6,3\t57,5\t31\n"
        )

    count = await NutritionDatasetImporter(db_session).import_open_food_facts_csv(off, dataset_version="off-official-test")
    await db_session.commit()

    row = (await db_session.execute(select(NutritionFoodReference))).scalar_one()
    assert count == 1
    assert row.source == "openfoodfacts"
    assert row.barcode == "3017620422003"
    assert row.name == "Pâte à tartiner noisettes"
    assert row.energy_kcal_100g == pytest.approx(199.8, abs=0.1)
    assert row.protein_g_100g == 6.3
    assert row.carbohydrates_g_100g == 57.5
    assert row.fat_g_100g == 31


@pytest.mark.asyncio
async def test_dataset_importer_skips_open_food_facts_rows_without_nutrition(db_session, tmp_path):
    off = tmp_path / "openfoodfacts-products.csv.gz"
    with gzip.open(off, "wt", encoding="utf-8") as handle:
        handle.write(
            "code\tproduct_name_fr\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tcarbohydrates_100g\tfat_100g\n"
            "000000000054\tLimonade sans nutrition\ten:france\t\t\t\t\n"
            "3017620422003\tPâte à tartiner noisettes\ten:france\t539\t6,3\t57,5\t31\n"
        )

    count = await NutritionDatasetImporter(db_session).import_open_food_facts_csv(off, dataset_version="off-skip-empty-test")
    await db_session.commit()

    rows = (await db_session.execute(select(NutritionFoodReference))).scalars().all()
    assert count == 1
    assert [row.barcode for row in rows] == ["3017620422003"]


@pytest.mark.asyncio
async def test_dataset_import_cli_imports_selected_snapshots(db_session, tmp_path):
    from app.services.nutrition.import_cli import import_datasets

    ciqual = tmp_path / "ciqual.csv"
    ciqual.write_text(
        "alim_code,alim_nom_fr,energy_kcal_100g,protein_g_100g,carbohydrates_g_100g,fat_g_100g\n"
        "2002,Pates cuites,150,5,30,1\n",
        encoding="utf-8",
    )
    off = tmp_path / "off.csv.gz"
    with gzip.open(off, "wt", encoding="utf-8") as handle:
        handle.write(
            "code,product_name,energy-kcal_100g,proteins_100g,carbohydrates_100g,fat_100g\n"
            "1112223334445,Sauce tomate test,44,1.5,7,1\n"
        )

    counts = await import_datasets(
        db_session,
        ciqual_path=ciqual,
        ciqual_version="ciqual-cli-test",
        off_path=off,
        off_version="off-cli-test",
    )
    await db_session.commit()

    rows = (await db_session.execute(select(NutritionFoodReference))).scalars().all()
    assert counts == {"ciqual": 1, "openfoodfacts": 1}
    assert {row.dataset_version for row in rows} == {"ciqual-cli-test", "off-cli-test"}


@pytest.mark.asyncio
async def test_dataset_import_cli_filters_open_food_facts_by_country_and_limit(db_session, tmp_path):
    from app.services.nutrition.import_cli import import_datasets

    off = tmp_path / "off.csv.gz"
    with gzip.open(off, "wt", encoding="utf-8") as handle:
        handle.write(
            "code\tproduct_name_fr\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tcarbohydrates_100g\tfat_100g\n"
            "1111111111111\tProduit France A\ten:france,en:belgium\t100\t1\t20\t1\n"
            "2222222222222\tProduit Etats-Unis\ten:united-states\t200\t2\t30\t2\n"
            "3333333333333\tProduit France B\ten:france\t300\t3\t40\t3\n"
        )

    counts = await import_datasets(
        db_session,
        off_path=off,
        off_version="off-fr-test",
        off_country="en:france",
        off_limit=1,
    )
    await db_session.commit()

    rows = (await db_session.execute(select(NutritionFoodReference))).scalars().all()
    assert counts == {"openfoodfacts": 1}
    assert [row.barcode for row in rows] == ["1111111111111"]


@pytest.mark.asyncio
async def test_dataset_import_cli_imports_ciqual_xlsx_snapshot(db_session, tmp_path):
    from app.services.nutrition.import_cli import import_datasets

    ciqual = tmp_path / "Table Ciqual 2025_FR_2025_11_03.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "composition nutritionnelle"
    sheet.append(
        [
            "alim_code",
            "alim_nom_fr",
            "Energie,\nRèglement\nUE N°\n1169\n2011 (kcal\n100 g)",
            "Protéines,\nN x\nfacteur de\nJones (g\n100 g)",
            "Glucides\n(g\n100 g)",
            "Lipides\n(g\n100 g)",
        ]
    )
    sheet.append(["5005", "Brocoli, cuit", "39", "3", "2", "0.6"])
    workbook.save(ciqual)

    counts = await import_datasets(db_session, ciqual_path=ciqual, ciqual_version="ciqual-cli-xlsx-test")
    await db_session.commit()

    row = (await db_session.execute(select(NutritionFoodReference))).scalar_one()
    assert counts == {"ciqual": 1}
    assert row.source_id == "5005"
    assert row.name == "Brocoli, cuit"
    assert row.dataset_version == "ciqual-cli-xlsx-test"
    assert row.energy_kcal_100g == 39


@pytest.mark.asyncio
async def test_dataset_importer_detects_semicolon_and_tab_delimiters(db_session, tmp_path):
    ciqual = tmp_path / "ciqual-semicolon.csv"
    ciqual.write_text(
        "alim_code;alim_nom_fr;energy_kcal_100g;protein_g_100g;carbohydrates_g_100g;fat_g_100g\n"
        "3003;Lentilles cuites;116;9;20;0.4\n",
        encoding="utf-8",
    )
    off = tmp_path / "off-tab.csv.gz"
    with gzip.open(off, "wt", encoding="utf-8") as handle:
        handle.write(
            "code\tproduct_name\tenergy-kcal_100g\tproteins_100g\tcarbohydrates_100g\tfat_100g\n"
            "2223334445556\tHoumous test\t280\t7\t14\t22\n"
        )

    importer = NutritionDatasetImporter(db_session)
    ciqual_count = await importer.import_ciqual_csv(ciqual, dataset_version="ciqual-delimiter-test")
    off_count = await importer.import_open_food_facts_csv(off, dataset_version="off-delimiter-test")
    await db_session.commit()

    rows = (await db_session.execute(select(NutritionFoodReference))).scalars().all()
    assert ciqual_count == 1
    assert off_count == 1
    assert {row.name for row in rows} == {"Lentilles cuites", "Houmous test"}
