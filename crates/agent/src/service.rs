use std::{path::PathBuf, sync::OnceLock, time::Duration};

use anyhow::{Context, Result};
use tracing::error;
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

use crate::runtime;

const SERVICE_NAME: &str = "AlphaPingAgent";
static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();
define_windows_service!(service_entry, service_main);

pub fn dispatch(config_path: PathBuf) -> Result<()> {
    CONFIG_PATH
        .set(config_path)
        .map_err(|_| anyhow::anyhow!("Windows service config was already initialized"))?;
    service_dispatcher::start(SERVICE_NAME, service_entry)?;
    Ok(())
}

fn service_main(_arguments: Vec<std::ffi::OsString>) {
    if let Err(error) = run_service() {
        error!(error = %error, "Windows service stopped with an error");
    }
}

fn run_service() -> Result<()> {
    let config_path = CONFIG_PATH
        .get()
        .context("Windows service config path was not initialized")?
        .clone();
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let status = service_control_handler::register(SERVICE_NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = shutdown_tx.send(true);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })?;
    status.set_service_status(service_status(ServiceState::Running, true, true))?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(runtime::run(&config_path, Some(shutdown_rx)));
    status.set_service_status(service_status(ServiceState::Stopped, false, result.is_ok()))?;
    result
}

fn service_status(state: ServiceState, accepts_control: bool, succeeded: bool) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if accepts_control {
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
        } else {
            ServiceControlAccept::empty()
        },
        exit_code: if succeeded {
            ServiceExitCode::Win32(0)
        } else {
            ServiceExitCode::ServiceSpecific(1)
        },
        checkpoint: 0,
        wait_hint: Duration::ZERO,
        process_id: None,
    }
}
