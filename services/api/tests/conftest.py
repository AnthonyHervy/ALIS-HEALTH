import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import get_session
from app.main import create_app
from app.models import Base


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine.sync_engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    async with sessionmaker() as session:
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def test_app(db_session):
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        secret_key="test-secret",
        pairing_code="dev-pairing-code",
        debug=True,
    )
    app = create_app(settings=settings)

    async def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    return app
