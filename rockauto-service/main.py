"""
RockAuto API Microservice for STREETO

A FastAPI wrapper around the rockauto-api Python library.
Provides REST endpoints for the Node.js STREETO app to query RockAuto.
"""

import os
import asyncio
from contextlib import asynccontextmanager
from typing import Optional, List
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from rockauto_api import RockAutoClient
from rockauto_api.models import (
    VehicleMakes, VehicleYears, VehicleModels, VehicleEngines,
    VehiclePartsResult, PartCategory, PartInfo
)


class Settings(BaseSettings):
    service_host: str = "0.0.0.0"
    service_port: int = 8001
    service_workers: int = 1
    cors_origins: str = "https://streeto.net,http://localhost:3000,http://localhost"
    rockauto_email: Optional[str] = None
    rockauto_password: Optional[str] = None
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


# Global client instance
rockauto_client: Optional[RockAutoClient] = None
authenticated = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global rockauto_client, authenticated
    
    # Startup
    rockauto_client = RockAutoClient()
    await rockauto_client.__aenter__()
    
    # Try to authenticate if credentials provided
    if settings.rockauto_email and settings.rockauto_password:
        try:
            success = await rockauto_client.login(
                settings.rockauto_email,
                settings.rockauto_password
            )
            authenticated = success
            print(f"RockAuto authentication: {'success' if success else 'failed'}")
        except Exception as e:
            print(f"RockAuto authentication error: {e}")
            authenticated = False
    
    yield
    
    # Shutdown
    if rockauto_client:
        await rockauto_client.__aexit__(None, None, None)


app = FastAPI(
    title="RockAuto API Service",
    description="Microservice for RockAuto automotive parts catalog",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# Pydantic response models
class MakeResponse(BaseModel):
    makes: List[dict] = Field(default_factory=list)


class YearsResponse(BaseModel):
    years: List[str] = Field(default_factory=list)


class ModelsResponse(BaseModel):
    models: List[dict] = Field(default_factory=list)


class EnginesResponse(BaseModel):
    engines: List[dict] = Field(default_factory=list)


class CategoriesResponse(BaseModel):
    categories: List[dict] = Field(default_factory=list)


class PartsResponse(BaseModel):
    parts: List[dict] = Field(default_factory=list)


class SearchResponse(BaseModel):
    parts: List[dict] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: str


# Dependency to get client
async def get_client() -> RockAutoClient:
    if rockauto_client is None:
        raise HTTPException(status_code=503, detail="RockAuto client not initialized")
    return rockauto_client


# ==================== VEHICLE ENDPOINTS ====================

@app.get("/makes", response_model=MakeResponse)
async def get_makes(client: RockAutoClient = Depends(get_client)):
    """Get all vehicle makes."""
    try:
        makes = await client.get_makes()
        return {"makes": [{"id": m.id, "name": m.name} for m in makes.makes]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get makes: {str(e)}")


@app.get("/years/{make}", response_model=YearsResponse)
async def get_years(make: str, client: RockAutoClient = Depends(get_client)):
    """Get years for a make."""
    try:
        years = await client.get_years(make.upper())
        return {"years": [str(y) for y in years.years]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get years: {str(e)}")


@app.get("/models/{make}/{year}", response_model=ModelsResponse)
async def get_models(make: str, year: int, client: RockAutoClient = Depends(get_client)):
    """Get models for a make and year."""
    try:
        models = await client.get_models(make.upper(), year)
        return {"models": [{"id": m.id, "name": m.name} for m in models.models]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get models: {str(e)}")


@app.get("/engines/{make}/{year}/{model}", response_model=EnginesResponse)
async def get_engines(make: str, year: int, model: str, client: RockAutoClient = Depends(get_client)):
    """Get engines for a make, year, and model."""
    try:
        engines = await client.get_engines(make.upper(), year, model.upper())
        return {"engines": [{"id": e.id, "name": e.name} for e in engines.engines]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get engines: {str(e)}")


# ==================== PARTS ENDPOINTS ====================

@app.get("/categories/{make}/{year}/{model}/{engine}", response_model=CategoriesResponse)
async def get_categories(
    make: str, year: int, model: str, engine: str,
    client: RockAutoClient = Depends(get_client)
):
    """Get part categories for a vehicle."""
    try:
        categories = await client.get_categories(
            make.upper(), year, model.upper(), engine
        )
        return {"categories": [{"id": c.id, "name": c.name} for c in categories.categories]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get categories: {str(e)}")


@app.get("/parts/{make}/{year}/{model}/{engine}/{category}", response_model=PartsResponse)
async def get_parts(
    make: str, year: int, model: str, engine: str, category: str,
    subcategory: Optional[str] = Query(None),
    client: RockAutoClient = Depends(get_client)
):
    """Get parts for a vehicle and category."""
    try:
        parts = await client.get_parts(
            make.upper(), year, model.upper(), engine, category, subcategory
        )
        return {"parts": [part_to_dict(p) for p in parts.parts]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get parts: {str(e)}")


@app.get("/search", response_model=SearchResponse)
async def search_parts(
    q: str = Query(..., min_length=1, description="Part number, name, or keyword"),
    client: RockAutoClient = Depends(get_client)
):
    """Search parts by number, name, or keyword."""
    try:
        results = await client.search_parts(q)
        return {"parts": [part_to_dict(p) for p in results]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


# ==================== UTILITY ENDPOINTS ====================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "rockauto-service",
        "authenticated": authenticated,
        "client_ready": rockauto_client is not None,
    }


@app.get("/status")
async def status_check():
    """Detailed status including auth state."""
    auth_status = "unauthenticated"
    if settings.rockauto_email and settings.rockauto_password:
        auth_status = "authenticated" if authenticated else "auth_failed"
    return {
        "service": "rockauto-service",
        "version": "1.0.0",
        "auth": auth_status,
        "client_initialized": rockauto_client is not None,
    }


def part_to_dict(part) -> dict:
    """Convert PartInfo to dict."""
    return {
        "brand": part.brand,
        "part_number": part.part_number,
        "description": part.description,
        "price": part.price,
        "image_url": part.image_url,
        "info_url": part.info_url,
        "notes": part.notes,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.service_host,
        port=settings.service_port,
        workers=settings.service_workers,
        reload=False,
        log_level=settings.log_level.lower(),
    )