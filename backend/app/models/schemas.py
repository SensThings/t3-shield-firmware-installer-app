from pydantic import BaseModel
from typing import Optional


class Settings(BaseModel):
    device_ip: str = "192.168.137.100"
    ssh_username: str = "dragon"
    ssh_password: str = "Sensthings@012"
    ghcr_username: str = "elmoadin"
    ghcr_token: str = "REPLACE_WITH_YOUR_GHCR_TOKEN"
    firmware_image: str = "ghcr.io/sensthings/t3shield-firmware:latest"


class InstallRequest(BaseModel):
    serial_number: str
    settings: Settings


class SdrTestRequest(BaseModel):
    serial_number: str
    settings: Settings
    dual_channel: bool = True


class AntennaTestRequest(BaseModel):
    label: str = ""
    dual_channel: bool = True


class TestConnectionRequest(BaseModel):
    host: str
    username: str
    password: str


class TestGhcrRequest(BaseModel):
    username: str
    token: str
    image: str = ""


class StepUpdate(BaseModel):
    step_number: int
    status: str
    message: Optional[str] = None
    duration: Optional[float] = None


class PrepStepUpdate(BaseModel):
    step_id: str
    status: str
    message: Optional[str] = None


class SdrMetrics(BaseModel):
    status: str
    peak_freq_hz: float
    expected_freq_hz: float
    freq_error_hz: float
    snr_db: float
    snr_threshold_db: float
    peak_power_db: float
    noise_floor_db: float
