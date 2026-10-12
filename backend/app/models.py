from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

Role = Literal["admin", "manager", "dispatcher", "rider"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def trim_text(cls, value: object, info: ValidationInfo) -> object:
        return value.strip() if isinstance(value, str) and info.field_name != "password" else value


class Login(Input):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


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
