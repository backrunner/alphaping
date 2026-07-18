use std::path::PathBuf;

use alphaping_agent::spool::Spool;
use anyhow::{Context, Result, bail};

fn main() -> Result<()> {
    let mut arguments = std::env::args_os().skip(1);
    let path = arguments
        .next()
        .map(PathBuf::from)
        .context("usage: resource_spool_fixture PATH")?;
    if arguments.next().is_some() {
        bail!("usage: resource_spool_fixture PATH");
    }
    let _spool = Spool::create(path, 1)?;
    Ok(())
}
