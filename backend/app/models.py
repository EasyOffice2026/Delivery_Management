import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

Role = Literal["admin", "manager", "kitchen", "dispatcher", "rider"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def trim_text(cls, value: object, info: ValidationInfo) -> object:
        return value.strip() if isinstance(value, str) and info.field_name != "password" else value


class Login(Input):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class Item(Input):
    name: str = Field(min_length=1, max_length=160)
    quantity: int = Field(ge=1, le=100)


class OrderInput(Input):
    branch_id: int
    source: Literal["talabat", "keeta", "direct"]
    external_id: str = Field(min_length=1, max_length=100)
    delivery_mode: Literal["platform", "own"]
    customer_name: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=20)
    area: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=500)
    items: list[Item] = Field(min_length=1, max_length=100)
    total_fils: int = Field(ge=0, le=100_000_000, strict=True)
    notes: str = Field(default="", max_length=1000)
    prep_minutes: int = Field(default=20, ge=1, le=180)

    @model_validator(mode="after")
    def delivery_details(self) -> "OrderInput":
        if self.source == "direct" and self.delivery_mode != "own":
            raise ValueError("Direct orders must use your own fleet")
        if self.delivery_mode == "own":
            if not all((self.customer_name, self.phone, self.area, self.address)):
                raise ValueError("Own-fleet orders require customer, phone, area and address")
            if not re.fullmatch(r"\+965\d{8}", self.phone):
                raise ValueError("Use a Kuwait phone number: +965 followed by 8 digits")
        elif any((self.customer_name, self.phone, self.area, self.address)):
            raise ValueError("Do not enter customer delivery details for platform-delivered orders")
        return self


class StatusInput(Input):
    status: Literal["accepted", "preparing", "ready", "handed_over", "cancelled"]
    reason: str = Field(default="", max_length=500)


class Assignment(Input):
    rider_id: int


class JobInput(Input):
    status: Literal["picked_up", "delivered", "failed"]
    reason: str = Field(default="", max_length=500)
    proof: str = Field(default="", max_length=500)


class Availability(Input):
    available: bool


class BranchInput(Input):
    name: str = Field(min_length=1, max_length=100)
    area: str = Field(min_length=1, max_length=100)


class UserInput(Input):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=200)
    role: Role
    branches: list[int] = Field(max_length=100)

    @model_validator(mode="after")
    def has_branches(self) -> "UserInput":
        if self.role != "admin" and not self.branches:
            raise ValueError("Non-admin users require at least one branch")
        return self


class CSVInput(Input):
    content: str = Field(min_length=1, max_length=500_000)
